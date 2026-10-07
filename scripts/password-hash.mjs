import {hashPassword} from '../server/auth.mjs';
// Pipe a password from a password manager or use a hidden terminal prompt.
// Never pass a password as an argument: shell history and process lists expose it.
let password='';
for await (const chunk of process.stdin) password+=chunk;
console.log(await hashPassword(password.replace(/\r?\n$/,'')));
