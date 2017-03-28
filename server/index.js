'use strict';

const bureauxVote = require('../bureaux.json')
const bluebird = require('bluebird');
const bodyParser = require('body-parser');
const express = require('express');
const Fuse = require('fuse.js')
const session = require('express-session');
const path = require('path');
const redisPkg = require('redis');
const validator = require('validator');


var app = express();
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
})
// console.log(listeCommune);

// Static files

// Config
app.locals.config = config;
app.enable('trust proxy');
app.set('views', './server/views');
app.set('view engine', 'pug');
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
    "insee"
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
    "insee",
    "nomcom",
    "dep"
    ]
  };
  var fuse = new Fuse(listeCommune, fuseOptions); // "list" is the item array
  var result = fuse.search(query);

  return res.json(result);
});

app.get('/bureau_vote/:insee/:bur', (req, res) => {
  return res.render('formForDelegue', {insee: req.params.insee, bur: req.params.bur});
});

app.listen(process.env.PORT || 3000, '127.0.0.1', (err) => {
  if (err) return console.error(err);

  console.log('Listening on http://localhost:' + (process.env.PORT || 3000));
});

module.exports = app;
