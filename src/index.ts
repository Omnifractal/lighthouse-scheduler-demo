import lighthouse from 'lighthouse/core/index.cjs';
import puppeteer from 'puppeteer';
import { Storage } from '@google-cloud/storage';

import type { Context } from '@google-cloud/functions-framework';
import type { Flags } from 'lighthouse/types/internal/global';

// Change these variables to match your needs
const FORM_FACTOR: 'mobile' | 'desktop' = 'desktop';
const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

const LH_CONFIG: Flags = {
  formFactor: FORM_FACTOR,
  throttlingMethod: 'simulate',
  screenEmulation: {
    mobile: (FORM_FACTOR as string) === 'mobile',
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
};

const STORAGE = new Storage();
const BUCKET_NAME = 'lh-control-reports';

/**
 * Background Cloud Function to be triggered by Pub/Sub.
 *
 * @param {any} message The Pub/Sub message.
 * @param {Context} context The event metadata.
 */
export const auditWithLighthouse = async (message: any, context: Context) => {
  const pubSubMessage = message.data ?
    Buffer.from(message.data, 'base64').toString() :
    null;

  if (!pubSubMessage) {
    console.log('No data found in the Pub/Sub message');
    return;
  }

  const data = JSON.parse(pubSubMessage);
  const url = data?.url;

  if (!url) {
    console.log('No URL found in the message');
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    devtools: false,
    args: [
      // Disables the sandbox security feature, which can sometimes cause
      // issues when running Lighthouse. However, this flag can expose you to
      // potential security risks, so use it with caution and only when
      // running audits on websites you trust.
      '--no-sandbox',

      // Disables the setuid sandbox, which can sometimes cause issues when
      // running Lighthouse. Like the --no-sandbox flag, this flag can expose
      // you to potential security risks, so use it with caution.
      '--disable-setuid-sandbox',

      //  Disables the software rasterizer, which can help reduce overhead and
      //  improve performance.
      '--disable-software-rasterizer',

      // Reduces the usage of shared memory, which can help avoid
      // out-of-memory issues in certain environments.
      '--disable-dev-shm-usage',

      // Set the language and region
      '--lang=en-US',
    ],
  }).catch((err) => {
    throw new Error(`Couldn't launch the browser instance: ${err.message}`);
  });

  const page = await browser.newPage();

  try {
    await page.goto(url);
  } catch (err: any) {
    throw new Error(err.message || `Something went wrong while navigating to ${url}. Are you sure you entered correct url?`);
  }

  const results = await lighthouse(url, {
    output: ['html', 'json'],
    ...LH_CONFIG,
  }, {
    extends: 'lighthouse:default',
  }, page)
    .catch((err: any) => {
      throw new Error(err.message || `Something went wrong while auditing ${url}`);
    });

  if (!results) {
    throw new Error(`Something went wrong while auditing ${url}. No results found`);
  }

  await page.close();
  await browser.close();

  uploadReport('html-reports', results.report[0]);
  uploadReport('json-reports', results.report[1]);
};

/**
 * Uploads a report to Google Cloud Storage.
 *
 * @param {string} folderName The name of the folder to upload the report to.
 * @param {string} report The report to upload.
 */
const uploadReport = (folderName: string, report: string) => {
  const filename = `${new Date().toISOString()}-report.${folderName.split('-')[0]}`;
  const file = STORAGE.bucket(BUCKET_NAME).file(`${folderName}/${filename}`);
  const stream = file.createWriteStream();

  stream.write(report);
  stream.end();
};
