/**
 * Stands in for an older pi, compiled by writeCompiledBunProgram: it says it is OLD_PI_VERSION, only says it updated, and
 * hands anything else to the real pi at REAL_PI, kept offline as the scripted model's pi is.
 */
const [command] = process.argv.slice(2);
if (command === "--version") {
  console.log(process.env.OLD_PI_VERSION);
  process.exit(0);
}
if (command === "update") {
  console.log(process.env.UPDATED_PI);
  process.exit(0);
}
const realPi = Bun.spawn([process.env.REAL_PI!, ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, PI_OFFLINE: "1" } });
process.exit(await realPi.exited);

export {};
