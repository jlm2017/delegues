let bureauxVote = require('../bureaux.json');


const communes = [];
const bureauxParCodeINSEE = {};

// console.log(bureauxVote);

bureauxVote.forEach(function(bureau) {
  if (!bureauxParCodeINSEE[bureau.insee]) {
    bureauxParCodeINSEE[bureau.insee] = [];
    communes.push({insee: bureau.insee, nomcom: bureau.nomcom, dep: bureau.dep});
  }
  bureauxParCodeINSEE[bureau.insee].push(bureau);
});


module.exports = {
  communes,
  bureauxParCodeINSEE
};
