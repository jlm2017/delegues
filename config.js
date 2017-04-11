function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : url + '/'
}

module.exports = {
  port: +process.env.PORT || 3000,
  emailTransport: process.env.SMTP_URL || 'smtp://localhost:1025',
  emailOptions: {
    from: process.env.EMAIL_FROM || 'JLM2017 <nepasrepondre@jlm2017.fr>'
  },
  mails: {
    confirmation: process.env.EMAIL_TEMPLATE_URL
  },
  host: ensureTrailingSlash(process.env.BASE_URL || ''),
  redisPrefix: 'jlm2017:bureaux:',
  secret: process.env.COOKIE_SECRET || 'lol',
};
