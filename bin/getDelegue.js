const bluebird = require('bluebird');
const redisPkg = require('redis');
const fs = require('fs');
const stringify = require('csv-stringify');

bluebird.promisifyAll(redisPkg.RedisClient.prototype);
bluebird.promisifyAll(redisPkg.Multi.prototype);

const config = require('../config');
var redis = redisPkg.createClient();

var jsonLog = {};

// Iterate people looking for offers
async function iterate() {
  console.log('new iteration of all requests');
  var cursor = 0;
  var datas;
  var assesseurRedis;
  var delegueRedis;
  var personInfo;

  // Iterate redis SCAN
  for(;;) {
    [cursor, datas] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}assesseurs:*:*:*`, 'COUNT', '99');
    for (var i = 0; i < datas.length; i++) {
      var data = datas[i];
      if ((assesseurRedis = await redis.getAsync(`${data}`))) {
        if ((personInfo = await redis.getAsync(`jlm2017:bureaux:${assesseurRedis}`))) {
          var assesseurJSON = (JSON.parse(personInfo));
          if (!jsonLog[assesseurJSON.insee]) {
            jsonLog[assesseurJSON.insee] = {};
          }
          if (!jsonLog[assesseurJSON.insee][assesseurJSON.bureaux]) {
            jsonLog[assesseurJSON.insee][assesseurJSON.bureaux] = {};
          }
          assesseurJSON.second_tour = assesseurJSON.second_tour ? 'oui' : 'non';
          jsonLog[assesseurJSON.insee][assesseurJSON.bureaux][assesseurJSON.role] = assesseurJSON;
          continue;
        }
      }
    }
    if (cursor == '0') {
      break;
    }
    var assesseurListe = [];

    for (var insee in jsonLog) {
      for (var bureau in jsonLog[insee]) {
        for (var role in jsonLog[insee][bureau]) {
          assesseurListe.push(jsonLog[insee][bureau][role]);
        }
      }
    }
  }

  var columns = {
    email: 'email',
    first_name: 'first_name',
    last_name: 'last_name',
    phone: 'phone',
    date: 'date',
    zipcode: 'zipcode',
    address1: 'address1',
    address2: 'address2',
    ville: 'ville_adresse',
    commune: 'commune',
    insee: 'insee',
    bureaux: 'bureaux',
    bureau_list: 'bureau_list',
    numero_list: 'numero_list',
    role: 'role',
    second_tour: 'second_tour'
  };

  stringify(assesseurListe, { header: true, columns: columns , quotedString: true, quotedEmpty: true}, function(err, output){
    var fileName = 'logs/' + (new Date()).toISOString() + '-extract-assesseurs.csv';

    fs.writeFileSync(fileName, output);
  });

  jsonLog = {};

  for(;;) {
    [cursor, datas] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}delegues:*:*`, 'COUNT', '99');

    for (var j = 0; j < datas.length; j++) {
      var data2 = datas[j];
      if ((delegueRedis = await redis.getAsync(`${data2}`))) {
        if ((personInfo = await redis.getAsync(`jlm2017:bureaux:${delegueRedis}`))) {
          var delegueJson = (JSON.parse(personInfo));

          if (!jsonLog[delegueJson.insee]) {
            jsonLog[delegueJson.insee] = {};
          }
          delegueJson.second_tour = delegueJson.second_tour ? 'oui' : 'non';
          jsonLog[delegueJson.insee][delegueJson.bur] = delegueJson;
          continue;
        }
      }
    }
    if (cursor == '0') {
      break;
    }
  }

  var delegueListe = [];

  for (var insee2 in jsonLog) {
    for (var bureau2 in jsonLog[insee2]) {
      delegueListe.push(jsonLog[insee2][bureau2]);
    }
  }

  var columns2 = {
    email: 'email',
    first_name: 'first_name',
    last_name: 'last_name',
    phone: 'phone',
    date: 'date',
    zipcode: 'zipcode',
    address1: 'address1',
    address2: 'address2',
    ville: 'ville_adresse',
    commune: 'commune',
    insee: 'insee',
    bureaux: 'bureaux',
    bureau_list: 'bureau_list',
    numero_list: 'numero_list',
    role: 'role',
    second_tour: 'second_tour'
  };

  stringify(delegueListe, { header: true, columns: columns2 , quotedString: true, quotedEmpty: true}, function(err, output){
    var fileName = 'logs/' + (new Date()).toISOString() + '-extract-delegues.csv';

    fs.writeFileSync(fileName, output);
  });
}

iterate()
  .then(() => {
    console.log('iteration finished');

    redis.quit();
  })
  .catch((err) => console.error(err.stack));
