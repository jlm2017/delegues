'use strict';

const bureauxVote = require('../bureaux.json');
const bluebird = require('bluebird');
const bodyParser = require('body-parser');
const express = require('express');
const session = require('express-session');
const Fuse = require('fuse.js');
const nodemailer = require('nodemailer');
const htmlToText = require('nodemailer-html-to-text').htmlToText;
const morgan = require('morgan');
const moment = require('moment');
const path = require('path');
const redisPkg = require('redis');
const request = require('request-promise-native');
const uuid = require('uuid/v4');
const validator = require('validator');

bluebird.promisifyAll(redisPkg.RedisClient.prototype);
bluebird.promisifyAll(redisPkg.Multi.prototype);

var app = express();
var wrap = fn => (...args) => fn(...args).catch(args[2]);
const config = require('../config');
var mailer = nodemailer.createTransport(config.emailTransport);
mailer.use('compile', htmlToText());
var RedisStore = require('connect-redis')(session);
var redis = redisPkg.createClient({prefix: config.redisPrefix});
var listeCommune = [];
var listeInsee = {};

// console.log(bureauxVote);

bureauxVote.forEach(function(bureau) {
  if (!listeInsee[bureau.insee]) {
    listeInsee[bureau.insee] = [];
    listeCommune.push({insee: bureau.insee, nomcom: bureau.nomcom, dep: bureau.dep});
  }
  listeInsee[bureau.insee].push(bureau);
});
// console.log(listeCommune);

// Static files

// Config
app.locals.config = config;
app.enable('trust proxy');
app.set('views', './server/views');
app.set('view engine', 'pug');
app.get('env') === 'development' && app.use(morgan('dev'));
app.use(bodyParser.json({limit: '5mb'}));
app.use(bodyParser.urlencoded({
  limit: '5mb',
  extended: true
}));
app.use(session({
  store: new RedisStore(),
  secret: config.secret
}));

// Public routes
app.get('/', (req, res) => {
  return res.redirect('/search');
});

app.get('/search', (req, res) => {
  return res.render('home', {user: 'test', bureauxVote: bureauxVote});
});

app.post('/search', wrap(async (req, res) => {
  var listBurInCom = [];
  for (var i = 0; i < listeInsee[req.body.insee].length; i++) {
    if (listeInsee[req.body.insee][i].full !== true) {
      if (await redis.getAsync(`${listeInsee[req.body.insee][i].insee}:${listeInsee[req.body.insee][i].bur}:s`)) {
        listeInsee[req.body.insee][i].full = true;
      }
      else {
        listBurInCom.push(listeInsee[req.body.insee][i]);
      }
    }
  }
  if (listBurInCom.length === 0) {
    return res.render('noBurInCom', {nomcom: listeInsee[req.body.insee][0].nomcom});
  }
  return res.render('listeByCom', {listeBur: listBurInCom});
}));

app.get('/search/json', (req, res) => {
  delete req.session.bur;
  var query = req.query.q[0];

  var fuseOptions = {
    shouldSort: true,
    threshold: 0.6,
    location: 0,
    distance: 100,
    maxPatternLength: 32,
    minMatchCharLength: 1,
    keys: [
      'nomcom'
    ]
  };
  var fuse = new Fuse(listeCommune, fuseOptions); // "list" is the item array
  var result = fuse.search(query).slice(0, 10);

  return res.json(result);
});

app.post('/bureau_vote/:insee', wrap(async (req, res) => {
  if(req.body.bureau) {
    req.session.bur = req.body.bureau;
  }
  return res.render('formForDelegue', {insee: req.params.insee, bur: req.session.bur, errors:req.session.errors, form: req.session.form});
}));

app.get('/bureau_vote/:insee', (req, res) => {
  return res.render('formForDelegue', {insee: req.params.insee, bur: req.params.bur, errors:req.session.errors, form: req.session.form});
});



app.post('/bureau_vote/:insee/:bur', wrap(async (req, res, next) => {
  req.session.errors = {};
  if (!req.body.first_name || !validator.isLength(req.body.first_name, {min: 1, max: 300})) {
    req.session.errors['first_name'] = 'Prénom invalide.';
  }
  if (!req.body.last_name || !validator.isLength(req.body.last_name, {min: 1, max: 300})) {
    req.session.errors['last_name'] = 'Nom invalide.';
  }
  if (!req.body.email || !validator.isEmail(req.body.email)) {
    req.session.errors['email'] = 'Email invalide.';
  }
  if (await redis.getAsync(`${req.body.email}`)) {
    req.session.errors['email'] = 'Email est déjà utilisé.';
  }
  if (!req.body.date || !moment(req.body.date, 'DD/MM/YYYY').isValid()) {
    req.session.errors['date'] = 'Date invalide.';
  }
  if (!req.body.address1 || !validator.isLength(req.body.address1, {min: 5, max: 500})) {
    req.session.errors['address'] = 'Adresse invalide.';
  }
  if (!validator.isLength(req.body.address2 || '', {min: 0, max: 500})) {
    req.session.errors['address'] = 'Adresse invalide.';
  }
  if (!req.body.phone || !validator.isMobilePhone(req.body.phone, 'fr-FR')) {
    req.session.errors['phone'] = 'Numéro invalide.';
  }

  if (Object.keys(req.session.errors).length > 0) {
    req.session.form = req.body;
    return res.redirect(`/bureau_vote/${req.params.insee}`);
  }

  delete req.session.errors;
  delete req.session.bur;
  delete req.session.form;

  req.session.insee = req.params.insee;
  req.session.bur = req.params.bur;
  // if new offer, add in the list of the commune
  var token = uuid();

  await redis.setAsync(token, JSON.stringify({
    email: req.body.email,
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    phone: req.body.phone,
    date: req.body.date,
    zipcode: req.body.zipcode,
    address1: req.body.address1,
    address2: req.body.address2,
    commune: req.body.commune,
    insee:  req.params.insee,
    bur:  req.params.bur
  }));

  var mailOptions = Object.assign({
    to: req.body.email,
    subject: 'Votre procuration',
    html: `${config.host}confirmation/${token}`
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err){
      return next(err);
    }
    res.redirect('/');
  });
}));

app.get('/confirmation/:token', wrap(async (req, res) => {
  var data = JSON.parse(await redis.getAsync(`${req.params.token}`));
  if (!data) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récement. Merci de vérifier dans\
      votre boîte mail.'
    });
  }
  await redis.delAsync(`${req.params.token}`);
  if (!await redis.getAsync(`${data.insee}:${data.bur}:t`)) {
    await redis.setAsync(`${data.insee}:${data.bur}:t`, JSON.stringify(data));
    await redis.setAsync(`${data.email}`, JSON.stringify(data));
    return res.redirect('/merci');
  }
  if (!await redis.getAsync(`${data.insee}:${data.bur}:s`)) {
    await redis.setAsync(`${data.insee}:${data.bur}:s`, JSON.stringify(data));
    await redis.setAsync(`${data.email}`, JSON.stringify(data));

    for (var i=0; i < listeInsee[req.params.insee].length; i++) {
      if (listeInsee[req.params.insee][i].bur === req.params.bur) {
        listeInsee[req.params.insee][i].full = true;
      }
    }
    return res.redirect('/merci');
  }

  return res.redirect('/no_need_delegue');
}));

app.get('/no_need_delegue', (req, res) => {
  if (req.session.insee && req.session.bur)
    return res.render('bureauPlein',  {insee: req.session.insee, bur: req.session.bur});
  return res.render('bureauPlein');

});


app.get('/merci', (req, res) => {
  if (req.session.insee && req.session.bur)
    return res.render('merci',  {insee: req.session.insee, bur: req.session.bur});
  return res.render('merci');

});

app.listen(process.env.PORT || 3000, '127.0.0.1', (err) => {
  if (err) return console.error(err);

  console.log('Listening on http://localhost:' + (process.env.PORT || 3000));
});

module.exports = app;
