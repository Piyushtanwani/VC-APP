require('dotenv').config();
const { sendOTP } = require('./utils/email');

async function test() {
  console.log('Testing with API KEY:', process.env.RESEND_API_KEY ? 'Set' : 'Missing');
  const success = await sendOTP('piyushtanwani2323@gmail.com', '123456', 'registration');
  if (success) {
    console.log('Test successful! OTP sent.');
  } else {
    console.error('Test failed! OTP could not be sent.');
  }
}
test();
