'use strict';

const bureauxVote = require('../bureaux.json');
const bluebird = require('bluebird');
const bodyParser = require('body-parser');
const express = require('express');
const session = require('express-session');
const Fuse = require('fuse.js');
const morgan = require('morgan');
const moment = require('moment');
const path = require('path');
const redisPkg = require('redis');
const request = require('request-promise-native');
const validator = require('validator');

bluebird.promisifyAll(redisPkg.RedisClient.prototype);
bluebird.promisifyAll(redisPkg.Multi.prototype);

var app = express();
var wrap = fn => (...args) => fn(...args).catch(args[2]);
const config = require('../config');
var RedisStore = require('connect-redis')(session);
var redis = redisPkg.createClient({prefix: config.redisPrefix});
var listeCommune = [];
var listeInsee = [];

// console.log(bureauxVote);

bureauxVote.forEach(function(bureau) {
  if (!listeInsee[bureau.insee]) {
    listeInsee[bureau.insee] = bureau.insee;
    listeCommune.push({insee: bureau.insee, nomcom: bureau.nomcom, dep: bureau.dep});
  }
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

app.post('/search', (req, res) => {
  var query = req.body.insee;

  var fuseOptions = {
    shouldSort: true,
    threshold: 0,
    location: 0,
    distance: 0,
    maxPatternLength: 32,
    minMatchCharLength: 1,
    keys: [
      'insee'
    ]
  };

  var fuse = new Fuse(bureauxVote, fuseOptions); // "list" is the item array
  var listBurInCom = fuse.search(query);

  return res.render('listeByCom', {listeBur: listBurInCom});
});

app.get('/search/json', (req, res) => {
  var query = req.query.q[0];

  var fuseOptions = {
    shouldSort: true,
    threshold: 0.6,
    location: 0,
    distance: 100,
    maxPatternLength: 32,
    minMatchCharLength: 1,
    keys: [
      'insee',
      'nomcom',
      'dep'
    ]
  };
  var fuse = new Fuse(listeCommune, fuseOptions); // "list" is the item array
  var result = fuse.search(query);

  return res.json(result);
});

app.get('/bureau_vote/:insee/:bur', (req, res) => {
  return res.render('formForDelegue', {insee: req.params.insee, bur: req.params.bur, errors:req.session.errors, form: req.session.form});
});

app.post('/bureau_vote/:insee/:bur', wrap(async (req, res) => {
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
  if (!req.body.date || !moment(req.body.date, 'DD/MM/YYYY').isValid()) {
    req.session.errors['date'] = 'Date invalide.';
  }
  if (!req.body.zipcode || !validator.matches(req.body.zipcode, /^\d{5}$/)) {
    req.session.errors['zipcode'] = 'Code postal invalide';
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

  var ban = await request({
    uri: `https://api-adresse.data.gouv.fr/search/?q=${req.body.commune}&type=municipality&citycode=${req.params.insee}&postcode=${req.body.zipcode}`,
    json: true
  });
  if (!ban.features.length) {
    req.session.errors['commune'] = 'Pas de commune avec ce code postal.';
  }

  if (Object.keys(req.session.errors).length > 0) {
    req.session.form = req.body;
    return res.redirect(`/bureau_vote/${req.params.insee}/${req.params.bur}`);
    // return res.render('formForDelegue', {form: req.body, errors: req.session.errors});
  }

  delete req.session.errors;

  req.session.insee = req.params.insee;
  req.session.bur = req.params.bur;
  // if new offer, add in the list of the commune

  if (!await redis.getAsync(`${req.params.insee}:${req.params.bur}:t`)) {
    await redis.setAsync(`${req.params.insee}:${req.params.bur}:t`, JSON.stringify({
      email: req.body.email,
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      phone: req.body.phone,
      date: req.body.date,
      zipcode: req.body.zipcode,
      address1: req.body.address1,
      address2: req.body.address2,
      commune: req.body.commune
    }));
    return res.redirect('/merci');
  }
  if (!await redis.getAsync(`${req.params.insee}:${req.params.bur}:s`)) {
    await redis.setAsync(`${req.params.insee}:${req.params.bur}:s`, JSON.stringify({
      email: req.body.email,
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      phone: req.body.phone,
      date: req.body.date,
      zipcode: req.body.zipcode,
      address1: req.body.address1,
      address2: req.body.address2,
      commune: req.body.commune
    }));
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
