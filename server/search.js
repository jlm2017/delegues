const Fuse = require('fuse.js');

const {communes} = require('./communes');

const fuseOptions = {
  shouldSort: true,
  include: ['score'],
  threshold: 0.1,
  location: 0,
  distance: 10,
  maxPatternLength: 32,
  minMatchCharLength: 2,
  keys: [
    'nomcom'
  ]
};

const fuse = new Fuse(communes, fuseOptions); // "list" is the item array

module.exports = fuse;
