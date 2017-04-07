'use strict';

const bluebird = require('bluebird');
const bodyParser = require('body-parser');
const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const htmlToText = require('nodemailer-html-to-text').htmlToText;
const morgan = require('morgan');
const moment = require('moment');
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


const {bureauxParCodeINSEE} = require('./communes');
const fuse = require('./search');

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

app.get('/', (req, res) => {
  var errors  = req.session.errors;
  delete req.session.errors;
  return res.render('home', {message: errors});
});

app.get('/recherche/suggestions', (req, res) => {
  var query = req.query.q[0];

  const result = fuse.search(query.slice(0, 300)).slice(0, 10);

  return res.json(result);
});

app.post('/recherche', (req, res) => {
  if (!bureauxParCodeINSEE[req.body.insee]) {
    return res.render('errorMessage', {message: 'Commune introuvable.'});
  }

  req.session.insee = req.body.insee;

  return res.redirect('/bureau');
});

app.get('/bureau', wrap(async (req, res) => {
  if (!req.session.insee) {
    return res.redirect('/');
  }

  var bureaux = bureauxParCodeINSEE[req.session.insee];
  var listBurInCom = [];
  for (var i = 0; i < bureaux.length; i++) {
    if (await redis.getAsync(`assesseurs:${bureaux[i].insee}:${bureaux[i].bur}:2`)) {
      continue;
    }
    listBurInCom.push(bureaux[i]);
  }

  if (listBurInCom.length === 0) {
    return res.render('errorMessage', {
      message: 'La totalité des bureaux de vote de cette commune ont déjà des assesseurs désignés. Nous vous remercions de votre volonté d\'aider la campagne.'
    });
  }

  return res.render('listeByCom', {commune: bureaux[0].nomcom, listeBur: listBurInCom});
}));

app.post('/bureau', wrap(async (req, res) => {
  if (!req.body.bureau) {
    return res.redirect('/bureau');
  }

  req.session.bur = req.body.bureau;

  return res.redirect('/coordonnees');
}));

app.get('/coordonnees', (req, res) => {
  if (!(req.session.bur && req.session.insee)) {
    return res.redirect('/');
  }

  return res.render('formForDelegue', {
    insee: req.params.insee,
    bur: req.session.bur,
    form: req.session.form
  });
});

app.post('/coordonnees', wrap(async (req, res, next) => {
  if (!(req.session.bur && req.session.insee)) {
    return res.redirect('/');
  }

  var errors = {};
  if (!req.body.first_name || !validator.isLength(req.body.first_name, {min: 1, max: 300})) {
    errors['first_name'] = 'Prénom invalide.';
  }
  if (!req.body.last_name || !validator.isLength(req.body.last_name, {min: 1, max: 300})) {
    errors['last_name'] = 'Nom invalide.';
  }
  if (!req.body.email || !validator.isEmail(req.body.email)) {
    errors['email'] = 'Email invalide.';
  }
  if (await redis.getAsync(`assesseurs:${req.body.email}`)) {
    errors['email'] = 'Email est déjà utilisé.';
  }
  if (!req.body.date || !moment(req.body.date, 'DD/MM/YYYY').isValid()) {
    errors['date'] = 'Date invalide.';
  }
  if (!req.body.address1 || !validator.isLength(req.body.address1, {min: 5, max: 500})) {
    errors['address'] = 'Adresse invalide.';
  }
  if (!validator.isLength(req.body.address2 || '', {min: 0, max: 500})) {
    errors['address'] = 'Adresse invalide.';
  }
  if (!req.body.phone || !validator.isMobilePhone(req.body.phone, 'fr-FR')) {
    errors['phone'] = 'Numéro invalide.';
  }

  if (Object.keys(errors).length > 0) {
    req.session.form = req.body;
    return res.render('formForDelegue', {
      insee: req.params.insee,
      bur: req.session.bur,
      errors: errors,
      form: req.body
    });
  }
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

  var emailContent = await request({
    uri: config.mails.envoiToken,
    qs: {
      EMAIL: req.body.email,
      LINK: `${config.host}confirmation/${token}`,
      BUREAU: `${req.params.insee}-${req.params.bur}`
    }
  });

  var mailOptions = Object.assign({
    to: req.body.email,
    subject: 'Confirmer votre inscription comme assesseur pour la France Insoumise',
    html: emailContent
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err){
      return next(err);
    }
    res.redirect('/email_envoye');
  });
}));

app.get('/email_envoye', (req, res) => {
  res.render('email_envoye');
});

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

  if (!await redis.getAsync(`${data.insee}:${data.bur}:1`)) {
    data.subscribtionDate = new Date();
    await redis.setAsync(`assesseurs:${data.insee}:${data.bur}:1`, JSON.stringify(data));
    await redis.setAsync(`assesseurs:${data.email}`, JSON.stringify(data));
    return res.redirect('/merci');
  }

  if (!await redis.getAsync(`assesseurs:${data.insee}:${data.bur}:2`)) {
    data.subscribtionDate = new Date();
    await redis.setAsync(`assesseurs:${data.insee}:${data.bur}:2`, JSON.stringify(data));
    await redis.setAsync(`${data.email}`, JSON.stringify(data));

    return res.redirect('/merci');
  }

  return res.redirect('/bureau_plein');
}));

app.get('/bureau_plein', (req, res) => {
  return res.render('errorMessage', {
    message: `Nous nous n'avons pas besoin de volontaire pour être assesseur\
    dans le bureau de vote&nbsp;: ${req.session.insee || ''}-${req.session.bur || ''}`
  });
});

app.get('/merci', (req, res) => {
  if (!(req.session.insee && req.session.bur)) {
    return res.redirect('/');
  }

  return res.render('merci',  {insee: req.session.insee, bur: req.session.bur});
});

app.listen(config.port, '127.0.0.1', (err) => {
  if (err) return console.error(err);

  console.log('Listening on http://localhost:' + config.port);
});

module.exports = app;
