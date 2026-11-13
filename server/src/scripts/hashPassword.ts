import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';

// Prints the value to put in APP_PASSWORD_HASH. The password itself is never stored.
const fromArg = process.argv[2];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const password = fromArg ?? (await rl.question('Password to use for the app: '));
rl.close();
if (password.length < 8) {
  console.error('Use at least 8 characters.');
  process.exit(1);
}
console.log(`APP_PASSWORD_HASH=${await bcrypt.hash(password, 12)}`);
