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
|assesseur:[INSEE]:[Bureau]:t            | Informations du premier assesseur titulaire (objet JSON)
|assesseur:[INSEE]:[Bureau]:s            | Informations du second suppléant (objet JSON)
|[token]                       | Informations liée au token (objet JSON) [token de validation]
|[email]                       | Informations liée a l'adresse email (objet JSON)
