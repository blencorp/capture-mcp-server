#!/usr/bin/env node
// Renders public/og.png, the picture shown with a shared link to the site (1200 x 630), in the
// site's own colors: the red BLEN wordmark on white, and the product's name in black, set in
// BLEN's typefaces. Run it (`pnpm og`) after a change: the result is committed, not
// built on deploy.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { productName, tagline } from '../product.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// satori reads WOFF, not WOFF2, so the faces come from the static font packages.
const font = (pkg, file) => readFileSync(resolve(here, '../node_modules', pkg, 'files', file));
const logo = readFileSync(resolve(here, '../src/assets/blen-logo-red.svg'));

const element = (type, style, children) => ({ type, props: { style, children } });

const svg = await satori(
  element(
    'div',
    {
      display: 'flex',
      width: '100%',
      height: '100%',
      backgroundColor: '#fff',
      color: '#111',
      fontFamily: 'Geist',
    },
    // The wordmark at the top and the name at the bottom, inside the card's margins.
    element(
      'div',
      { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, margin: '72px 80px 80px' },
      [
        {
          type: 'img',
          props: { src: `data:image/svg+xml;base64,${logo.toString('base64')}`, width: 118, height: 48 },
        },
        element('div', { display: 'flex', flexDirection: 'column' }, [
          element(
            'div',
            { fontSize: 78, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.05em' },
            productName,
          ),
          element(
            'div',
            { marginTop: 18, fontFamily: 'Instrument Serif', fontStyle: 'italic', fontSize: 46, lineHeight: 1.1, color: '#444' },
            tagline,
          ),
        ]),
      ],
    ),
  ),
  {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Geist', weight: 900, style: 'normal', data: font('@fontsource/geist', 'geist-latin-900-normal.woff') },
      {
        name: 'Instrument Serif',
        weight: 400,
        style: 'italic',
        data: font('@fontsource/instrument-serif', 'instrument-serif-latin-400-italic.woff'),
      },
    ],
  },
);

// satori draws the text as shapes, so the image needs no installed font.
const { width, height } = await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(resolve(here, '../public/og.png'));
console.log(`public/og.png: ${width} x ${height}`);
