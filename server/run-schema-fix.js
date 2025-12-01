const { runSchemaMigration } = require('./utils/schema-migration');

console.log("Running manual schema migration...");
runSchemaMigration()
  .then(() => {
    console.log("Migration SUCCESS");
    process.exit(0);
  })
  .catch(err => {
    console.error("Migration FAILED:", err);
    process.exit(1);
  });
