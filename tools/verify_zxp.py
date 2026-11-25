#!/usr/bin/env python3
"""Verifica un .zxp como lo hace Adobe: mimetype primero y sin comprimir, digests SHA-256 de cada archivo,
digest C14N del Manifest y firma RSA de SignedInfo con el certificado incluido. Implementación independiente (lxml)."""
import sys, zipfile, hashlib, base64
from lxml import etree
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

# Nota: el C14N inclusivo de lxml sobre un subárbol añade xmlns="" espurios; sin otros espacios de nombres
# en juego, el C14N exclusivo produce exactamente el C14N inclusivo correcto.
DS = '{http://www.w3.org/2000/09/xmldsig#}'
ALG = {'http://www.w3.org/2000/09/xmldsig#rsa-sha1': hashes.SHA1(), 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256': hashes.SHA256()}

def verify(path):
    z = zipfile.ZipFile(path)
    infos = z.infolist()
    warnings = []
    if infos[0].filename != 'mimetype': warnings.append('mimetype no es el primer archivo del zip')
    if z.getinfo('mimetype').compress_type != zipfile.ZIP_STORED: warnings.append('mimetype comprimido')
    assert z.read('mimetype') == b'application/vnd.adobe.air-ucf-package+zip'
    root = etree.fromstring(z.read('META-INF/signatures.xml'))
    sig = root.find(DS + 'Signature')
    si = sig.find(DS + 'SignedInfo')
    ref = si.find(DS + 'Reference')
    manifest = sig.find(DS + 'Object').find(DS + 'Manifest')
    assert ref.get('URI') == '#' + manifest.get('Id')
    digest = base64.b64encode(hashlib.sha256(etree.tostring(manifest, method='c14n', exclusive=True)).digest()).decode()
    assert digest == ref.find(DS + 'DigestValue').text.strip(), 'digest del Manifest no coincide'
    cert = x509.load_der_x509_certificate(base64.b64decode(sig.find('.//' + DS + 'X509Certificate').text))
    alg = ALG[si.find(DS + 'SignatureMethod').get('Algorithm')]
    cert.public_key().verify(base64.b64decode(sig.find(DS + 'SignatureValue').text), etree.tostring(si, method='c14n', exclusive=True), padding.PKCS1v15(), alg)
    listed = set()
    for r in manifest.findall(DS + 'Reference'):
        name = r.get('URI'); listed.add(name)
        assert base64.b64encode(hashlib.sha256(z.read(name)).digest()).decode() == r.find(DS + 'DigestValue').text.strip(), 'digest de ' + name
    files = {i.filename for i in infos if not i.filename.endswith('/')} - {'META-INF/signatures.xml'}
    assert files == listed, 'archivos sin firmar o ausentes: %s' % (files ^ listed)
    return len(listed), cert.subject.rfc4514_string(), cert.not_valid_after_utc, warnings

if __name__ == '__main__':
    for p in [a for a in sys.argv[1:] if not a.startswith('--')]:
        n, who, until, warnings = verify(p)
        print('%s  %s · %d archivos · %s · válido hasta %s' % ('OK' if not warnings else 'AVISO', p.split('/')[-1], n, who, until.date()))
        for w in warnings: print('   - ' + w)
        if warnings and '--strict' in sys.argv: sys.exit(1)
