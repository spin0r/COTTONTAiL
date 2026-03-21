require("dotenv").config();

const BASE_URL = "https://magicnzb.com";

// Default cookies (can be overridden via /login or fetched from external URL)
const COOKIES = process.env.COOKIES || "";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";

module.exports = { BASE_URL, COOKIES, TELEGRAM_TOKEN };
