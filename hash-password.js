import bcrypt from 'bcryptjs';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter the password to hash: ', async (password) => {
    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);
    console.log('\nHashed password (add this to your .env file as ADMIN_PASSWORD):');
    console.log(hash);
    rl.close();
});
