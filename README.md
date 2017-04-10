# Délégués et assesseurs dans les bureaux de votes

## Installation

You need a Redis server on localhost and Node >= 7.6.

```bash
$ git clone https://github.com/jlm2017/delegues.git
$ cd delegues
$ cp config.js.dist config.js
$ npm install
$ npm start
```

This project works well with [Mosaico standalone](https://github.com/jlm2017/mosaico-standalone) to create email templates.


## Liste des clés Redis

| Clé                          | Valeur
|------------------------------|-------------
|assesseurs:[INSEE]:[Bureau]:1 | Informations de l'assesseur titulaire (objet JSON)
|assesseurs:[INSEE]:[Bureau]:2 | Informations de l'assesseur suppléant (objet JSON)
|delegues:[INSEE]:[Bureau]     | Informations du délégué du bureau (objet JSON)
|[token]                       | Informations liée au token (objet JSON) [token de validation]
|[email]                       | Informations liée a l'adresse email (objet JSON)
