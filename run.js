#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs');

process.on('unhandledRejection', (err) => {
  console.error(err);
  process.exit(1);
});

const ACCOUNTS_URL = 'https://ibanking.stgeorge.com.au/ibank/viewAccountPortfolio.html';
const LOGIN_URL = 'https://ibanking.stgeorge.com.au/ibank/loginPage.action';

const creds = require('./creds.json');
const headless = false;

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync('./cookies.json', JSON.stringify(cookies));
}

async function loadMaybeLogin(page, url) {
  await page.goto(url, {waitUntil: 'networkidle2'});
  const hasError = (await page.evaluate(() => {
    return Boolean(document.body.querySelector('.ico.ico-error'));
  }));
  if (!hasError) {
    saveCookies(page);
    return;
  }

  await page.goto(LOGIN_URL, {waitUntil: 'networkidle2'});
  await page.type('#access-number', creds.accessNumber);
  await page.type('#securityNumber', creds.securityNumber);
  await page.type('#internet-password', creds.password)

  // run both at once, otherwise looks for _next_ nav way after click
  await Promise.all([
    page.click('#logonButton'),
    page.waitForNavigation({waitUntil: 'networkidle2'}),
  ]);

  // save login cookies
  await saveCookies(page);

  // redirect to desired page
  if (page.url() !== url) {
    await page.goto(url, {waitUntil: 'networkidle2'});
  }
}

(async () => {
  const browser = await puppeteer.launch({headless});
  const page = await browser.newPage();

  let cookies = [];
  try {
    const raw = fs.readFileSync('./cookies.json', 'utf-8');
    cookies = JSON.parse(raw);
  } catch (e) {};
  await page.setCookie(...cookies);
  console.info('loaded', cookies.length, 'cookies');

  await loadMaybeLogin(page, ACCOUNTS_URL);

  const details = await page.$eval('#acctSummaryList', (ul) => {
    const maybeReadValue = (li, titleClass) => {
      const node = li.querySelector(`dt.${titleClass}`);
      if (!node || !node.nextElementSibling) {
        return null;
      }
      // regexp ugh (greedy: not a space, anything*, not a space)
      const raw = node.nextElementSibling.textContent.match(/([^\s].*[^\s])/)[0] || '';
      const sign = (raw[0] === '-' ? -1 : +1);   // retain '-'
      const safe = raw.replace(/[^\d\.]/g, '');  // remove non-number, non-'.'
      const value = +safe;
      if (isNaN(value)) {
        return null;
      }
      return value * sign;
    };

    return Array.from(ul.children).map((li) => {
      return {
        alias: li.getAttribute('data-acctalias'),
        balance: maybeReadValue(li, 'account-balance'),
        available: maybeReadValue(li, 'available-balance'),
        account: maybeReadValue(li, 'account-number'),
        bsb: maybeReadValue(li, 'bsb-number'),
      };
    });
  });

  console.info(details);
  await page.close();
})();
