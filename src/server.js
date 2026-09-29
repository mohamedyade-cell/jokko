const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const app = createApp();

app.listen(port, () => {
  console.log(`Jokko démarré sur http://localhost:${port}`);
  if (!app.locals.config.integrationToken) {
    console.log('INTEGRATION_TOKEN non défini : le webhook de candidatures LinkedIn / Indeed est désactivé.');
  }
});
