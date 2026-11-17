// ดึงโมเดลออกจาก index.html ตรง ๆ เพื่อไม่ให้มีโค้ดสองชุดที่ต้องคอยซิงก์กัน
import {readFileSync} from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const js   = html.split("<script>")[1].split("</script>")[0];
const src  = js.slice(0, js.indexOf("/*==================== แถบกรอก"));
const {MARKET, EMPTY, DEMO, FIELDS, DEAL_KEYS, calc, pmt, irr, npv, maxPrice, requiredADR, TESTS, screenDeal, dealA} =
  new Function(src + `; return {MARKET, EMPTY, DEMO, FIELDS, DEAL_KEYS, calc, pmt, irr, npv, maxPrice, requiredADR, TESTS, screenDeal, dealA};`)();
import assert from "node:assert";

const near = (a, b, tol, msg) => {
  const ok = Math.abs(a - b) <= tol;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg.padEnd(46)} got ${(+a).toFixed(6)}  want ~${b}`);
  if (!ok) process.exitCode = 1;
};
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

// ---------- ฟังก์ชันการเงินพื้นฐาน ----------
near(pmt(0.06/12, 180, 265e6*0.6), 1341814, 2000, "PMT ผ่อนต่อเดือน");
near(irr([-100, 60, 60]), 0.1306623, 1e-5, "IRR กรณีตรวจสอบ");
near(npv(0.1306623, [-100, 60, 60]), 0, 1e-4, "NPV ที่ IRR = 0");

// ---------- ยังต้องตรงกับไฟล์ Excel ต้นทาง ----------
const D = {...MARKET, ...DEMO.values};
const r = calc(D);
console.log("\n--- ดีลตัวอย่าง (ต้องตรงกับ Excel) ---");
near(r.tc/1e6,      272.65, 0.01,  "เงินลงทุนรวม");
near(r.yoc,         0.065,  0.003, "Yield on Cost ~6.5%");
near(r.irrL,        0.0665, 0.004, "Levered IRR ~6.65%");
near(r.balloon/1e6, 69.4,   0.6,   "หนี้คงเหลือปี 10 ~69.4 ลบ.");
near(r.dscr1,       0.935,  0.05,  "DSCR ปี 1 ต่ำกว่า 1.0");
near((r.rows.reduce((s,x)=>s+x.cfL,0) + r.cfL[0])/1e6, 98.0, 1.5, "ยอดสะสมผู้ถือหุ้นปี 10 ~98 ลบ.");
near(r.exitNet, (r.rows[9].noi/D.exitCap)*(1-D.saleCostPct), 1, "ขายต่อสุทธิ = NOI10/cap x (1-cost)");
near(calc({...D, opexMode:"split"}).rows[2].opex, r.rows[2].opex, 2, "โหมด split ตรงกับ flat ที่ปี 3");

// ---------- หน้าว่างต้องว่างจริง ----------
console.log("\n--- สถานะเริ่มต้นและการล้างค่า ---");
const E = EMPTY();
ok(DEAL_KEYS.every(k => E[k] === null), "เปิดแอปมา ข้อมูลดีลทั้ง 3 ช่องเป็น null");
ok(!DEAL_KEYS.some(k => E[k] === DEMO.values[k]), "ไม่มีค่าใดของดีลตัวอย่างหลงอยู่ในสถานะเริ่มต้น");
ok(Object.keys(MARKET).every(k => !DEAL_KEYS.includes(k)),
   "MARKET ไม่มีค่าที่เป็นตัวตนของดีล (ราคา/ห้อง/ADR)");
ok(FIELDS.filter(f => f.layer === "deal").length === 3 && FIELDS.filter(f => f.req).length === 2,
   "ช่องข้อมูลดีล 3 ช่อง · บังคับจริง 2 ช่อง (ราคา + จำนวนห้อง)");
ok(FIELDS.filter(f => f.g).every(f => MARKET[f.k] !== undefined),
   "ทุกช่องสมมติฐานมีค่าตั้งต้นตลาดครบ");

// ---------- เพดานราคา: ห้ามทิ้งเกณฑ์ที่ทำไม่ได้เงียบ ๆ ----------
console.log("\n--- เพดานราคา ---");
const caps = maxPrice(D);
near(caps.find(c => c.t.k === "yoc").p/1e6, 229.2, 1.5, "เพดาน @ YoC 7.5% ~229 ลบ.");
ok(caps.every(c => c.p !== null || typeof c.reason === "string"),
   "ทุกเกณฑ์คืนเพดานหรือเหตุผล ไม่มีการทิ้งเงียบ");
// ในโหมดต้นทุน % คงที่ NOI เป็นบวกเสมอ ราคาถูกพอจึงผ่านได้ทุกเกณฑ์ — เป็นคุณสมบัติของโมเดล ไม่ใช่บั๊ก
ok(maxPrice({...D, adr:300, occ1:.2, occ2:.2, occ3:.2}).every(c => c.p !== null),
   "รายได้ต่ำแต่ต้นทุนยังเป็น % -> ยังมีราคาที่ผ่านได้ (ตรวจว่าไม่รายงาน null มั่ว)");
// ต้นทุนเกินรายได้ -> NOI ติดลบทุกราคา ต้องรายงาน null พร้อมเหตุผล ห้ามคืนตัวเลขลวง
const hopeless = maxPrice({...D, cStaff:.90});
ok(hopeless.every(c => c.p === null && c.reason),
   "ต้นทุนเกินรายได้ -> ทุกเกณฑ์รายงาน null พร้อมเหตุผล");

// ---------- ซื้อเงินสด: เกณฑ์ที่ต้องมีหนี้ต้องหายไป ไม่ใช่โชว์ค่าเพี้ยน ----------
console.log("\n--- ซื้อด้วยเงินสด (LTV = 0) ---");
const cash = calc({...D, ltv: 0});
ok(cash.balloon === 0 && !isFinite(cash.dscr1) && isFinite(cash.irrU), "LTV=0 คำนวณได้ ไม่พัง");
ok(cash.occDebt === 0, "ไม่มีหนี้ -> Occupancy ที่ต้องพอผ่อนหนี้ = 0");
ok(maxPrice({...D, ltv:0}).length === TESTS.filter(t => !t.needsDebt).length,
   "LTV=0 -> เหลือเฉพาะเกณฑ์ที่ไม่ต้องมีหนี้");

// ---------- โหมดย้อนกลับ: รู้แค่ราคากับจำนวนห้อง ----------
console.log("\n--- โหมดย้อนกลับ (ยังไม่รู้ ADR) ---");
const need = requiredADR({...MARKET, price:265e6, rooms:76, adr:2000});
ok(need.length > 0 && need.every(x => x.adr === null || x.adr > 0), "คำนวณ ADR ที่ต้องทำได้ครบทุกเกณฑ์");
const needYoC = need.find(x => x.t.k === "yoc").adr;
near(calc({...MARKET, price:265e6, rooms:76, adr:needYoC}).yoc, MARKET.targetYoC, 0.0005,
     "ADR ที่แก้ได้ ทำให้ YoC แตะเป้าพอดี");
ok(needYoC > 2200, "ที่ราคา 265 ลบ. ต้องทำ ADR สูงกว่า 2,200 ถึงจะผ่าน YoC");

// ---------- ทิศทาง sensitivity ----------
console.log("\n--- ทิศทาง sensitivity ---");
ok(calc({...D, price:200e6}).yoc  > r.yoc,  "ราคาถูกลง -> YoC สูงขึ้น");
ok(calc({...D, occ3:.75}).yoc     > r.yoc,  "occ สูงขึ้น -> YoC สูงขึ้น");
ok(calc({...D, rate:.07}).irrL    < r.irrL, "ดอกเบี้ยขึ้น -> Levered IRR ลง");
ok(calc({...D, exitCap:.09}).irrL < r.irrL, "exit cap ขึ้น -> Levered IRR ลง");
ok(calc({...D, citRate:.20}).irrL < r.irrL, "ใส่ภาษี -> IRR ลง");
ok(calc({...D, terminalMode:"forward"}).exitNet > r.exitNet, "forward NOI -> ขายต่อสูงขึ้น");
ok(calc({...D, opexMode:"split"}).rows[0].ebitda < r.rows[0].ebitda,
   "โหมด split กด EBITDA ปีแรกลง (operating leverage ทำงาน)");

// ---------- แท็บเทียบดีล ----------
console.log("\n--- เทียบดีล ---");
const js2 = html.split("<script>")[3].split("</script>")[0];
const cmpSrc = js2.slice(js2.indexOf("const CMP_ROWS"), js2.indexOf("function renderCmp"));
const {CMP_ROWS} = new Function("const pct=v=>v,nf=v=>v,xx=v=>v;" + cmpSrc + "; return {CMP_ROWS};")();

const metrics = CMP_ROWS.filter(x => x[0] !== "sect");
const marked  = metrics.filter(x => x[2]);
const ABSOLUTE = ["ราคาเสนอขาย", "เงินลงทุนรวม", "รายได้รวม", "NOI ปีคงที่", "NPV", "เพดานราคา"];
ok(metrics.length >= 14, `ตารางเทียบมี ${metrics.length} แถวตัวเลข`);
ok(marked.length >= 6, `ติ๊ก ✓ ให้ ${marked.length} แถว`);
ok(marked.every(x => !ABSOLUTE.some(a => x[0].includes(a))),
   "ไม่ติ๊ก ✓ ให้ตัวเลขสัมบูรณ์ (โรงแรมใหญ่กว่าย่อมมากกว่าเสมอ)");
ok(marked.some(x => x[0].includes("Yield on Cost")) && marked.some(x => x[0].includes("DSCR")),
   "ติ๊ก ✓ ให้ตัวเลขที่หารขนาดออกแล้ว");
ok(marked.every(x => x[2] === "high" || x[2] === "low"), "ทุกแถวที่ติ๊กระบุทิศทางชัดเจน");

// ราคาต่ำกว่าเพดานต้องไม่พิมพ์เปอร์เซ็นต์ติดลบ
const gapRow = metrics.find(x => x[0].includes("ส่วนต่างราคา"));
ok(!!gapRow, "มีแถวส่วนต่างราคา");
ok(gapRow && !String(gapRow[3](-1.718)).includes("-"), "ราคาต่ำกว่าเพดาน -> ไม่แสดงเปอร์เซ็นต์ติดลบ");
ok(gapRow && String(gapRow[3](0.22)).includes("ต่อรองลง"), "ราคาสูงกว่าเพดาน -> บอกว่าต้องต่อรองลง");

// เทียบ 3 ดีลจริงด้วยสมมติฐานชุดเดียวกัน
const deals3 = [
  {n:"หัวหิน 76 ห้อง 265 ลบ.",  price:265e6, rooms:76},
  {n:"เกาะเสม็ด 24 ห้อง 69 ลบ.", price:69e6,  rooms:24},
  {n:"เชียงใหม่ 42 ห้อง 42 ลบ.", price:42e6,  rooms:42},
].map(d => ({...d, r: calc({...D, price:d.price, rooms:d.rooms})}));
deals3.forEach(d => console.log(`      ${d.n.padEnd(26)} YoC ${(d.r.yoc*100).toFixed(1)}%  DSCR ${d.r.dscr1.toFixed(2)}`));
ok(deals3[2].r.yoc > deals3[1].r.yoc && deals3[1].r.yoc > deals3[0].r.yoc,
   "ราคาต่อห้องถูกกว่าที่สมมติฐานเดียวกัน -> YoC สูงกว่าตามลำดับ");

// ---------- หน้ารายการ: คัดกรองจาก 4 ช่อง ----------
console.log("\n--- คัดกรองดีลแบบย่อ ---");
const hh = screenDeal({priceM:265, rooms:76, adr:2200, occ:65});
near(hh.fair/1e6, 221.7, 0.5, "หัวหิน: มูลค่าตามรายได้ = NOI ÷ 8% ~221.7 ลบ.");
near(hh.worth/1e6, 206.6, 0.5, "หัวหิน: ราคาสูงสุดที่ยังคุ้ม ~206.6 ลบ. (ตรงกับหน้ารายละเอียด)");
ok(hh.lo < hh.fair && hh.fair < hh.hi, "ช่วงสมเหตุผลครอบมูลค่ากลาง");
ok(hh.price.g === "fail" && hh.buy.g === "fail", "หัวหิน 265 ลบ.: ตั้งราคาสูงเกินไป และยังไม่คุ้ม");
const cheap = screenDeal({priceM:200, rooms:76, adr:2200, occ:65});
ok(cheap.price.g === "pass" && cheap.buy.g === "pass" && cheap.passed === cheap.total, "ราคาเดียวกันที่ 200 ลบ.: สมเหตุผลและคุ้ม");
ok(screenDeal({priceM:230, rooms:76, adr:2200, occ:65}).price.g !== "fail", "230 ลบ. อยู่ในช่วง ไม่ถูกตัดสินว่าสูงเกินไป");
ok(screenDeal({priceM:null, rooms:76}).state === "empty", "ยังไม่กรอกราคา -> ไม่คำนวณ");
const na = screenDeal({priceM:69, rooms:24, adr:null, occ:null});
ok(na.state === "noadr" && na.need > 1500 && na.need < 3500, "ไม่รู้ราคาห้อง -> บอกราคาห้องที่ต้องทำได้ (" + Math.round(na.need) + " บาท)");
ok(dealA({priceM:100, rooms:10, adr:1000, occ:null}).occ3 === MARKET.occ3, "ไม่กรอกอัตราเข้าพัก -> ใช้ค่าตลาด");

const cm = screenDeal({priceM:42, rooms:42, adr:null, occ:null});
ok(cm.state === "noadr" && cm.need > 500 && cm.need < 1500,
   "โรงแรมราคาถูกที่ไม่รู้ราคาห้อง ต้องได้คำตอบ ไม่ใช่ 'ไม่คุ้มทุกกรณี' (" + Math.round(cm.need) + " บาท)");

console.log(process.exitCode ? "\n*** มีข้อที่ไม่ผ่าน ***" : "\nครบทุกข้อ ✓");
