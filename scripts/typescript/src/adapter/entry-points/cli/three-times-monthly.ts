const run = async () => {
  const now = new Date();
  console.log(now)
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
