#!/usr/bin/env node
/*
 * Empaqueta src/ como Gravedad-<versión>.zxp firmado (mismo formato que ZXPSignCmd: XMLDSig con manifiesto SHA-256,
 * firma RSA-SHA1 y certificado autofirmado). El zip lleva "mimetype" primero y sin comprimir.
 * Uso: node tools/pack.js   (certificado en .cert/, se crea si no existe; o GRAVEDAD_CERT_DIR=<carpeta>)
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src'), DIST = path.join(ROOT, 'dist');
const CERT_DIR = process.env.GRAVEDAD_CERT_DIR || path.join(ROOT, '.cert');
const MIME = 'application/vnd.adobe.air-ucf-package+zip';
const DS = 'http://www.w3.org/2000/09/xmldsig#', C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315', SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

function version() {
  const m = fs.readFileSync(path.join(SRC, 'CSXS', 'manifest.xml'), 'utf8').match(/ExtensionBundleVersion="([^"]+)"/);
  if (!m) throw Error('manifest.xml sin versión');
  return m[1];
}

function checkSources(v) {
  // El host debe ser ASCII (ExtendScript) y la versión coherente en todos los sitios.
  for (const f of fs.readdirSync(path.join(SRC, 'host')).filter((n) => n.endsWith('.jsx'))) {
    if (/[^\x00-\x7f]/.test(fs.readFileSync(path.join(SRC, 'host', f), 'utf8'))) throw Error('host/' + f + ' tiene caracteres no ASCII: ejecuta node tools/ascii-jsx.js');
  }
  const checks = [['host/gravedad.jsx', /VERSION = '([^']+)'/], ['app.js', /VERSION = '([^']+)'/]];
  for (const [f, re] of checks) { const m = fs.readFileSync(path.join(SRC, f), 'utf8').match(re); if (!m || m[1] !== v) throw Error(f + ' declara la versión ' + (m && m[1]) + ' y el manifiesto ' + v); }
}

function ensureCert() {
  const key = path.join(CERT_DIR, 'gravedad.key'), crt = path.join(CERT_DIR, 'gravedad.crt');
  if (!fs.existsSync(key) || !fs.existsSync(crt)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '7300', '-keyout', key, '-out', crt, '-subj', '/C=ES/ST=Madrid/O=Gravedad/CN=Gravedad Extension'], { stdio: 'ignore' });
    fs.chmodSync(key, 0o600);
    console.log('Certificado autofirmado creado en', CERT_DIR);
  }
  const pem = fs.readFileSync(crt, 'utf8');
  return { key: fs.readFileSync(key, 'utf8'), der: Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64') };
}

function list(dir, base) {
  let out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === '.DS_Store' || name.startsWith('._')) continue;
    const full = path.join(dir, name), rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) out = out.concat(list(full, rel)); else out.push(rel);
  }
  return out;
}

const b64 = (buf) => buf.toString('base64');
const wrap64 = (s) => s.replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
const sha256 = (buf) => b64(crypto.createHash('sha256').update(buf).digest());
// C14N inclusivo de un elemento hijo de <Signature>: hereda la declaración xmlns y los vacíos se escriben abiertos/cerrados.
const canonical = (xml, tag) => xml.replace('<' + tag, '<' + tag + ' xmlns="' + DS + '"').replace(/<(\w+)([^<>]*?)\/>/g, '<$1$2></$1>');

function sign(stage, files, cert) {
  const refs = files.map((f) => '<Reference URI="' + f + '"><DigestMethod Algorithm="' + SHA256 + '"/><DigestValue>' + sha256(fs.readFileSync(path.join(stage, f))) + '</DigestValue></Reference>').join('');
  const manifest = '<Manifest Id="PackageContents">\n' + refs + '</Manifest>';
  const signedInfo = '<SignedInfo>\n<CanonicalizationMethod Algorithm="' + C14N + '"/>\n<SignatureMethod Algorithm="' + DS + 'rsa-sha1"/>\n<Reference Type="' + DS + 'Manifest" URI="#PackageContents">\n<Transforms>\n<Transform Algorithm="' + C14N + '"/>\n</Transforms>\n<DigestMethod Algorithm="' + SHA256 + '"/>\n<DigestValue>' + sha256(Buffer.from(canonical(manifest, 'Manifest'))) + '</DigestValue>\n</Reference>\n</SignedInfo>';
  const value = crypto.createSign('RSA-SHA1').update(canonical(signedInfo, 'SignedInfo')).sign(cert.key);
  return '<signatures>\n<Signature xmlns="' + DS + '" Id="PackageSignature">\n' + signedInfo + '\n<SignatureValue Id="PackageSignatureValue">' + wrap64(b64(value)) + '</SignatureValue>\n\n<KeyInfo>\n<X509Data>\n<X509Certificate>' + wrap64(b64(cert.der)) + '\n</X509Certificate>\n</X509Data>\n</KeyInfo>\n<Object>\n' + manifest + '\n</Object>\n</Signature>\n</signatures>\n';
}

function main() {
  const v = version();
  checkSources(v);
  const stage = path.join(DIST, 'Gravedad'), out = path.join(DIST, 'Gravedad-' + v + '.zxp');
  fs.rmSync(stage, { recursive: true, force: true }); fs.rmSync(out, { force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync(SRC, stage, { recursive: true, filter: (p) => !/(^|[\/\\])(\.DS_Store|\._[^\/\\]*)$/.test(p) });
  fs.writeFileSync(path.join(stage, 'mimetype'), MIME);
  const files = ['mimetype'].concat(list(stage, '').filter((f) => f !== 'mimetype'));
  fs.mkdirSync(path.join(stage, 'META-INF'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'META-INF', 'signatures.xml'), sign(stage, files, ensureCert()));
  // mimetype primero y sin comprimir; después todo lo demás comprimido, sin atributos extra (-X).
  execFileSync('zip', ['-X', '-0', '-q', out, 'mimetype'], { cwd: stage });
  execFileSync('zip', ['-X', '-9', '-r', '-q', out, '.', '-x', 'mimetype'], { cwd: stage });
  // Copia instalable a mano (carpeta de extensiones) también en zip.
  const folderZip = path.join(DIST, 'Gravedad-' + v + '-carpeta.zip');
  fs.rmSync(folderZip, { force: true });
  execFileSync('zip', ['-X', '-9', '-r', '-q', folderZip, 'Gravedad'], { cwd: DIST });
  console.log('Creado', path.relative(ROOT, out), '(' + Math.round(fs.statSync(out).size / 1024) + ' KB,', files.length, 'archivos firmados)');
  return out;
}

if (require.main === module) main();
module.exports = { main, canonical, sign };
