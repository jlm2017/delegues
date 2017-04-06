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
  var delegueRedis;

  // Iterate redis SCAN
  for(;;) {
    [cursor, datas] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}*:*:*`, 'COUNT', '99');

    for (var i = 0; i < datas.length; i++) {
      var data = datas[i];
      if ((delegueRedis = await redis.getAsync(`${data}`))) {
        var delegueJson = (JSON.parse(delegueRedis));

        if (!jsonLog[delegueJson.insee]) {
          jsonLog[delegueJson.insee] = {};
        }
        if (!jsonLog[delegueJson.insee][delegueJson.bur]) {
          jsonLog[delegueJson.insee][delegueJson.bur] = {};
        }
        jsonLog[delegueJson.insee][delegueJson.bur][delegueJson.role] = delegueJson;
        continue;
      }
    }
    if (cursor == '0') {
      break;
    }
  }

  var delegueListe = [];

  for (var insee in jsonLog) {
    for (var bureau in jsonLog[insee]) {
      for (var role in jsonLog[insee][bureau]) {
        delegueListe.push(jsonLog[insee][bureau][role]);
      }
    }
  }

  var columns = {
    insee: 'insee',
    bur: 'bureau',
    first_name: 'first_name',
    last_name: 'last_name',
    email: 'email',
    phone: 'phone',
    date: 'birthday',
    subscribtionDate: 'subscribtionDate',
    address1: 'address1',
    address2: 'address2',
    role: 'role'
  };

  stringify(delegueListe, { header: true, columns: columns , quotedString: true, quotedEmpty: true}, function(err, output){
    var fileName = Date.now() + '-extract-delegue.csv';

    fs.writeFileSync(fileName, output);
  });


}

iterate()
  .then(() => {
    console.log('iteration finished');

    redis.quit();
  })
  .catch((err) => console.error(err.stack));
