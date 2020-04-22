#!/usr/bin/env node

import puppeteer from 'puppeteer';
import chalk from 'chalk';
import {promises as fs} from 'fs';
import * as helper from './lib/helper.js';

const log = (...args) => {
  const d = new Date();
  const pad = (x) => (x < 0 ? '0' + x : x);
  const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  process.stderr.write(`[${chalk.gray(ts)}] ${args.join(' ')}\n`);
};


process.on('unhandledRejection', (err) => {
  console.error(err);
  process.exit(1);
});


const ACCOUNT_URL = 'https://28degrees-online.latitudefinancial.com.au/wps/myportal/28degrees/public/home';
const LOGIN_URL = 'https://28degrees-online.latitudefinancial.com.au/access/login';
const headless = false;


async function loadMaybeLogin(page, url) {
  await page.goto(url, {waitUntil: 'networkidle2'});

  const isLoginPage = () => page.evaluate(() => {
    return Boolean(document.body.querySelector('input#AccessToken_Username'));
  });

  if (await isLoginPage()) {
    const creds = await helper.loadJSON('./config/creds.json');
    await helper.maybeGoto(page, LOGIN_URL);
    await page.type('#AccessToken_Username', creds.username);
    await page.type('#AccessToken_Password', creds.password);
    log('Logging in...')

    // run both at once, otherwise looks for _next_ nav way after click
    await Promise.all([
      page.click('#login-submit'),
      page.waitForNavigation({waitUntil: 'networkidle2'}),
    ]);

    if (await isLoginPage()) {
      throw new Error(`could not login, is login page again: ${page.url()}`);
    }
  }

  const cookies = await page.cookies();
  log('Saving', cookies.length, 'cookies');
  await fs.writeFile('./config/cookies.json', JSON.stringify(cookies));

  await helper.maybeGoto(page, url);
}


function processContainers(containers) {
  const q = (container, name) => {
    const el = container.querySelector(`[name="${name}"]`);
    return el ? el.textContent : '';
  };

  const processRow = (container) => {
    const pending = container.querySelector('[name="Pending_transactionAmount"]');

    const rawAmount = q(container,
        pending ? 'Pending_transactionAmount' : 'Transaction_Amount');
    const amount = parseFloat(rawAmount.replace(/[^\d\.\-]/g, ''));

    const description = q(container, pending ? 'Pending_transactionDescription' : 'Transaction_TransactionDescription');
    const cardName = q(container, pending ? 'Pending_cardName' : 'Transaction_CardName');

    const rawDate = q(container, pending ? 'Pending_transactionDate' : 'Transaction_TransactionDate');
    const d = new Date(rawDate);
    if (+d) {
      const inverseHours = d.getTimezoneOffset() / 60;
      d.setUTCHours(d.getUTCHours() - inverseHours);
    }

    return {
      pending: Boolean(pending),
      description,
      cardName,
      amount,
      date: d.toISOString().slice(0, 10),
    };
  };
  return containers.map(processRow);
}


(async () => {
  const args = [`--window-size=${~~helper.randomRange(1000, 1200)},${~~helper.randomRange(600, 800)}`];
  const browser = await puppeteer.launch({headless, args});
  const page = await browser.newPage();

  const cookies = await helper.loadJSON('./config/cookies.json', []);
  log('Loaded', cookies.length, 'cookies');
  await page.setCookie(...cookies);

  await loadMaybeLogin(page, ACCOUNT_URL);

  const currentBalance = await page.$eval('#current-expenses-value', helper.valueFromElement);
  const availableBalance = await page.$eval('#available-balance-value', helper.valueFromElement);
  const transactions = await page.$$eval('[name="DataContainer"]', processContainers);

  const fixedFormat = (amount, digits=5) => {
    return amount.toFixed(2).padStart(digits + 3, ' ');
  };
  log('Current balance:  ', chalk.red('$ ' + fixedFormat(currentBalance)));
  log('Available balance:', chalk.green('$ ' + fixedFormat(availableBalance)));

  log('Recent transactions:');
  for (const t of transactions) {
    const dollarAmount = `${t.pending ? '^' : ' '}$ ${fixedFormat(t.amount)}`;
    let color = chalk.red;
    if (t.amount >= 0) {
      color = chalk.green;
    } else if (t.pending) {
      color = chalk.blue;
    }
    const parts = [chalk.magenta(t.date), chalk.gray(t.cardName), color(dollarAmount), t.description];
    process.stderr.write(parts.join(' ') + '\n');
  }

  process.stdout.write(JSON.stringify({
    currentBalance,
    availableBalance,
    transactions,
  }));

  await browser.close();
})();
