const Fuse = require('fuse.js');

const {communes} = require('./communes');

const fuseOptions = {
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

const fuse = new Fuse(communes, fuseOptions); // "list" is the item array

module.exports = fuse;
