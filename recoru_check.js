require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const prompt = require("prompt-sync")();

// ----------------------
// config.json読み込み
// ----------------------
const configPath = path.join(process.cwd(), "config.json");
if (!fs.existsSync(configPath)) {
  console.error(
    "⚠ config.json が見つかりません。EXEと同じフォルダに配置してください。"
  );
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// ----------------------
// 部署選択 (番号)
// ----------------------
async function selectBushoByIndex(page, listSelector, choice) {
  await page.waitForSelector(listSelector, { timeout: 5000 });

  const items = await page.$$eval(listSelector, (els) =>
    els.map((e) => {
      const span = e.querySelector("span");
      return {
        id: e.getAttribute("id") || "",
        text: (span ? span.innerText : e.innerText).trim(),
      };
    })
  );

  const index = parseInt(choice, 10) - 1;
  if (isNaN(index) || index < 0 || index >= items.length) {
    console.error("番号が正しくありません");
    return false;
  }

  const targetId = items[index].id;
  const sel = `#SIDE-MENU li[id="${targetId}"] a`;
  const handle = await page.$(sel);
  if (handle) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await handle.click();
    console.log(`✅ ${items[index].text} 選択完了`);
    return true;
  } else {
    console.error("깃허브테스트handle.clickが見つかりません깃허브테스트");
    return false;
  }
}

// ----------------------
// 部署選択 (名前)
// ----------------------
async function selectBushoByName(page, listSelector, name) {
  await page.waitForSelector(listSelector, { timeout: 5000 });

  const clicked = await page.$$eval(
    listSelector,
    (els, targetName) => {
      const item = els.find((e) => {
        const span = e.querySelector("span");
        return span && span.innerText.trim() === targetName;
      });
      if (!item) return false;
      const a = item.querySelector("a");
      if (!a) return false;
      a.click();
      return true;
    },
    name
  );

  if (clicked) console.log(`✅ "${name}" 選択完了`);
  else console.error(`❌ "${name}" 選択失敗`);
  return clicked;
}

// ----------------------
// 年月選択
// ----------------------
async function selectYearMonth(page, targetYear, targetMonth) {
  await page.waitForSelector(".acm-displayDate", { timeout: 10000 });
  await page.click(".acm-displayDate");

  while (true) {
    const [currentYear, currentMonth] = await page.evaluate(() => {
      const year = parseInt(
        document.querySelector(".ui-datepicker-year").innerText,
        10
      );
      const monthText = document.querySelector(
        ".ui-datepicker-month"
      ).innerText;
      const month = parseInt(monthText.replace("月", ""), 10);
      return [year, month];
    });

    if (currentYear === targetYear && currentMonth === targetMonth) break;

    if (
      currentYear > targetYear ||
      (currentYear === targetYear && currentMonth > targetMonth)
    ) {
      await page.click(".ui-datepicker-prev");
    } else {
      await page.click(".ui-datepicker-next");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await page.$$eval(".ui-datepicker-calendar td a", (els) => {
    const firstDay = els.find((e) => e.innerText === "1");
    if (firstDay) firstDay.click();
  });

  console.log(`✅ ${targetYear}年 ${targetMonth}月 1日 選択完了`);
}

// ----------------------
// ログイン (失敗時処理付き)
// ----------------------
async function login(page, browser) {
  // アラート検知
  page.on("dialog", async (dialog) => {
    console.error("❌ ログイン失敗: " + dialog.message());
    await dialog.dismiss();
    await browser.close();
    process.exit(1);
  });

  await page.goto("https://app.recoru.in/ap/", { waitUntil: "networkidle2" });
  await page.type("#contractId", config.recoru.RECORU_CONTRACTID);
  await page.type("#authId", config.recoru.RECORU_USER);
  await page.type("#password", config.recoru.RECORU_PASS);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="button"]'),
  ]);

  // ログイン成功を確認 (#m2)
  try {
    await page.waitForSelector("#m2", { timeout: 5000 });
    await page.click("#m2");
    console.log("✅ ログイン成功");
  } catch (err) {
    console.error(
      "❌ ログインに失敗しました。ID/パスワードを確認してください。"
    );
    await browser.close();
    process.exit(1);
  }
}

async function processStaffPages(page, yearInput, monthInput, day = 1) {
  const mm = String(monthInput).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const trClass = `${yearInput}${mm}${dd}`; // ex: 20250701

  let hasNextPage = true;

  // 2️⃣ 테이블 로딩 대기
  while (hasNextPage) {
    await page.waitForSelector(`tr[class*="${trClass}"]`, { timeout: 10000 });
    const links = await page.$$eval(
      `tr[class*="${trClass}"] td.item-userNameAndId a.link`,
      (els) => els.map((el) => el.href)
    );

    console.log(`총 ${links.length}명의 사원 링크 수집 완료`);

    // 4️⃣ 각 사원 순회
    for (const href of links) {
      const staffPage = await page.browser().newPage();
      await staffPage.goto(href, { waitUntil: "networkidle2" });

      console.log(`✅ 처리중: ${href}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await staffPage.close();
    }

    const nextButton = await page.$('div.pager li[onclick="nextPage();"]');
    if (nextButton) {
      console.log("➡ 다음 페이지로 이동");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        nextButton.click(),
      ]);
      // 잠깐 대기
      await page.waitForTimeout(500);
    } else hasNextPage = false;
  }
  console.log("모든 사원 처리 완료");
}

// ----------------------
// メイン
// ----------------------
async function main() {
  // CLI入力
  console.log("部署を選択してください：");
  console.log("1: 経営総括部");
  console.log("2: 大阪本社");
  console.log("3: 本社営業部");
  console.log("4: 事業総括部");
  console.log("5: システム開発1部");
  console.log("6: システム開発2部");
  console.log("7: システム開発3部");
  console.log("8: エンベデッド部");
  console.log("9: 人事DX部");
  console.log("10: ビジネスサポート部");

  const choice = prompt("番号入力: ");
  const yearInput = parseInt(prompt("年入力 (例：2025)："), 10);
  const monthInput = parseInt(prompt("月入力 (1~12):："), 10);

  const map = {
    1: "経営総括部",
    2: "大阪本社",
    3: "本社営業部",
    4: "事業総括部",
    5: "システム開発1部",
    6: "システム開発2部",
    7: "システム開発3部",
    8: "エンベデッド部",
    9: "人事DX部",
    10: "ビジネスサポート部",
  };
  const mappedName = map[choice];

  // ブラウザ起動
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: config.chrome.CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
    defaultViewport: null,
  });
  const page = await browser.newPage();

  // ログイン実行 (失敗時は自動終了)
  await login(page, browser);

  const listSelector = "#SIDE-MENU li";

  // 部署選択実行
  let okA = await selectBushoByIndex(page, listSelector, choice);
  if (!okA && mappedName) {
    await selectBushoByName(page, listSelector, mappedName);
  }

  // 年月選択実行
  await selectYearMonth(page, yearInput, monthInput);

  console.log(
    `部署、年月選択完了：${mappedName}, ${yearInput}年 ${monthInput}月`
  );

  await processStaffPages(page, yearInput, monthInput);

  // ブラウザ閉じる
  // await browser.close();
}

main();
