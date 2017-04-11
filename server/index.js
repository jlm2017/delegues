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

const labels = {
  delegues: {
    singular: 'délégué&middot;e',
    plural: 'délégué&middot;es'
  },
  assesseurs: {
    singular: 'assesseur&middot;e',
    plural: 'assesseur&middot;e&middot;s'
  }
};

const {bureauxParCodeINSEE} = require('./communes');
const fuse = require('./search');

async function freeBureaux(role, insee) {
  var bureaux = bureauxParCodeINSEE[insee];
  var listBurInCom = [];
  for (var i = 0; i < bureaux.length; i++) {
    if (await redis.getAsync(`${role}:${bureaux[i].insee}:${bureaux[i].bur}${role === 'assesseurs' ? ':2' : ''}`)) {
      continue;
    }

    listBurInCom.push(bureaux[i].bur);
  }

  return listBurInCom;
}

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

app.use('/public', express.static('./public'));

app.get('/', (req, res) => {
  var errors  = req.session.errors;
  delete req.session.errors;
  delete req.session.form;
  delete req.session.commune;
  return res.render('roleChoice', {errors});

});

app.get('/delegue', (req, res) => {
  req.session.role = 'delegues';

  return res.render('communeChoice');
});

app.get('/assesseur', (req, res) => {
  req.session.role = 'assesseurs';

  return res.render('communeChoice');
});

app.get('/recherche/suggestions/communes', (req, res) => {
  var query = req.query.q[0];

  const result = fuse.search(query.slice(0, 300)).slice(0, 10);

  return res.json(result);
});

app.post('/commune', (req, res) => {
  if (!req.session.role) {
    return res.redirect('/');
  }

  if (!bureauxParCodeINSEE[req.body.insee]) {
    return res.render('errorMessage', {message: 'Commune introuvable.'});
  }

  req.session.insee = req.body.insee;

  return res.redirect('/bureau');
});

app.all('/bureau', (req, res, next) => {
  if (!req.session.insee || !req.session.role) {
    return res.redirect('/');
  }

  next();
});

app.get('/bureau', wrap(async (req, res) => {
  var bureaux = await freeBureaux(req.session.role, req.session.insee);

  if (bureaux.length === 0) {
    return res.render('errorMessage', {
      message: `La totalité des bureaux de vote de cette commune ont déjà des ${req.session.role} désignés. Nous vous remercions de votre volonté d\'aider la campagne.`
    });
  }

  req.session.commune = bureaux[0].nomcom;

  return res.render('burChoice', {
    commune: req.session.commune,
    bureaux: bureaux,
    role: req.session.role
  });
}));

app.post('/bureau', wrap(async (req, res) => {
  if (!req.body.bureau) {
    return res.redirect('/bureau');
  }

  var bureaux = await freeBureaux(req.session.role, req.session.insee);

  if (req.session.role === 'assesseurs' && !bureaux.includes(req.body.bureau)) {
    return res.status(401).render('errorMessage', {
      message: 'Ce bureau de vote n\'existe pas ou est déjà réservé.'
    });
  }


  if (req.session.role === 'delegues') {
    if (!Array.isArray(req.body.bureau)) {
      return res.sendStatus(401);
    }

    if (req.body.bureau.filter(elem => !bureaux.includes(elem)).length > 0) {
      return res.sendStatus(401);
    }
  }

  req.session.bureaux = req.body.bureau;

  return res.redirect('/coordonnees');
}));

app.all('/coordonnees', (req, res, next) => {
  if (!(req.session.bureaux && req.session.insee && req.session.role)) {
    return res.redirect('/');
  }

  next();
});

app.get('/coordonnees', (req, res) => {
  return res.render('formForDelegue', {
    insee: req.params.insee,
    form: req.session.form
  });
});

app.post('/coordonnees', wrap(async (req, res, next) => {
  var errors = {};

  if (!req.body.bureau || !validator.isNumeric(req.body.bureau)) {
    errors['bureau'] = 'Numéro invalide.';
  }
  if (!req.body.numero_inscription || !validator.isNumeric(req.body.numero_inscription)) {
    errors['numero_inscription'] = 'Numéro invalide.';
  }
  if (!req.body.first_name || !validator.isLength(req.body.first_name, {min: 1, max: 300})) {
    errors['first_name'] = 'Prénom invalide.';
  }
  if (!req.body.last_name || !validator.isLength(req.body.last_name, {min: 1, max: 300})) {
    errors['last_name'] = 'Nom invalide.';
  }
  if (!req.body.email || !validator.isEmail(req.body.email)) {
    errors['email'] = 'Email invalide.';
  }
  var data = JSON.parse(await redis.getAsync(`${req.body.email}`));
  if (data && data.confirmation) {
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
      errors: errors,
      form: req.body
    });
  }

  delete req.session.form;

  // if new offer, add in the list of the commune
  var token = uuid();

  await redis.setAsync(token, JSON.stringify({
    email: req.body.email,
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    bureau_list: req.body.bureau,
    numero_list: req.body.numero_inscription,
    phone: req.body.phone,
    date: req.body.date,
    zipcode: req.body.zipcode,
    address1: req.body.address1,
    address2: req.body.address2,
    commune: req.session.commune,
    insee:  req.session.insee,
    bureaux:  req.session.bureaux,
    role: req.session.role
  }));

  var emailContent = await request({
    uri: config.mails.envoiToken,
    qs: {
      EMAIL: req.body.email,
      LINK: `${config.host}confirmation/${token}`,
      BUREAU: `${req.session.commune}-${req.session.bureaux}`
    }
  });

  var mailOptions = Object.assign({
    to: req.body.email,
    subject: `Confirmer votre inscription comme ${req.session.role.slice(0, req.session.role.length - 1)} pour la France Insoumise`,
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

  if (data.role === 'assesseurs') {
    if (await redis.getAsync(`assesseurs:${data.insee}:${data.bureaux}:2`)) {
      return res.redirect('/bureau_plein');
    }

    data.confirmation = new Date();
    await redis.setAsync(`${data.email}`, JSON.stringify(data));

    var suppleant = await redis.getAsync(`assesseurs:${data.insee}:${data.bureaux}:1`);

    await redis.setAsync(`assesseurs:${data.insee}:${data.bureaux}:${suppleant ? '2':'1'}`, JSON.stringify(data));

    return res.redirect('/delegues/merci');
  } else if (data.role === 'delegues') {
    if (data.bureaux.filter(elem => !freeBureaux(data.role, data.insee).includes(elem)).length > 0) {
      return res.redirect('/bureau_plein');
    }

    data.confirmation = new Date();
    await redis.setAsync(`${data.email}`, JSON.stringify(data));

    for (var i = 0; i < data.bureaux.length; i++) {
      await redis.setAsync(`delegues:${req.session.insee}:${data.bureaux}`);
    }

    return res.redirect('/assesseurs/merci');
  }
}));

app.get('/bureau_plein', (req, res) => {
  if (req.session.role === 'assesseurs') {
    return res.render('errorMessage', {
      message: `Nous nous n'avons plus besoin de volontaires pour être ${labels[req.session.role].singular}\
      dans ces bureaux.`
    });
  }
});

app.get('/:role/merci', (req, res) => {
  if (!['assesseurs', 'delegues'].includes(req.params.role)) {
    return res.sendStatus(404);
  }

  return res.render('merci',  {role: labels[req.params.role].singular});
});

app.listen(config.port, '127.0.0.1', (err) => {
  if (err) return console.error(err);

  console.log('Listening on http://localhost:' + config.port);
});

module.exports = app;
