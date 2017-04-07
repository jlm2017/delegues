function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : url + '/'
}

module.exports = {
  port: +process.env.PORT,
  emailTransport: process.env.SMTP_URL,
  emailOptions: {
    from: process.env.EMAIL_FROM
  },
  mails: {
    envoiToken: process.env.EMAIL_TEMPLATE_URL
  },
  host: ensureTrailingSlash(process.env.BASE_URL || ''),
  redisPrefix: 'jlm2017:delegues:',
  secret: process.env.COOKIE_SECRET,
};
