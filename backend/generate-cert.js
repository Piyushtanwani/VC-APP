const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { generateKeyPairSync, createSign, X509Certificate } = require('crypto');

// Generate RSA key pair
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

// Export private key to PEM
const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

// We'll use Node's built-in self-signed cert generation via TLS
// Since Node doesn't have a built-in X509 cert creator, we'll use a simpler approach
// with the selfsigned npm package or just create with forge

// Actually, let's just use a simple approach - create cert with Node's native crypto
const forge = (() => {
  try {
    return require('node-forge');
  } catch (e) {
    return null;
  }
})();

if (!forge) {
  console.log('Installing node-forge for certificate generation...');
  execSync('npm install node-forge', { cwd: __dirname, stdio: 'inherit' });
}

const nodeForge = require('node-forge');
const pki = nodeForge.pki;

console.log('Generating self-signed certificate...');

const keys = pki.rsa.generateKeyPair(2048);
const cert = pki.createCertificate();

cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
  { name: 'commonName', value: 'localhost' },
  { name: 'organizationName', value: 'ConnectFlow Dev' },
];

cert.setSubject(attrs);
cert.setIssuer(attrs);

cert.setExtensions([
  { name: 'subjectAltName', altNames: [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '192.168.1.5' },
    { type: 7, ip: '127.0.0.1' },
  ]},
]);

cert.sign(keys.privateKey, nodeForge.md.sha256.create());

const certPem = pki.certificateToPem(cert);
const keyPemForge = pki.privateKeyToPem(keys.privateKey);

fs.writeFileSync(path.join(__dirname, 'cert.pem'), certPem);
fs.writeFileSync(path.join(__dirname, 'key.pem'), keyPemForge);

console.log('Certificate generated: cert.pem & key.pem');
