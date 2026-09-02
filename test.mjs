// ดึงโมเดลออกจาก index.html ตรง ๆ เพื่อไม่ให้มีโค้ดสองชุดที่ต้องคอยซิงก์กัน
import {readFileSync} from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const js   = html.split("<script>")[1].split("</script>")[0];
const src  = js.slice(0, js.indexOf("/* ============================ ตัวช่วยจัดรูปแบบ"));
const {DEFAULTS, calc, pmt, irr, npv} =
  new Function(src + "; return {DEFAULTS, calc, pmt, irr, npv};")();
import assert from "node:assert";

const near = (a, b, tol, msg) => {
  const ok = Math.abs(a - b) <= tol;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg.padEnd(44)} got ${(+a).toFixed(6)}  want ~${b}`);
  if (!ok) process.exitCode = 1;
};

// ---- ตรวจฟังก์ชันการเงินพื้นฐานกับค่าที่ Excel ให้ ----
// PMT(6%/12, 180, 159,000,000) -> 1,341,833 บาท/เดือน โดยประมาณ
const loan = 265e6 * 0.6;
const pay = pmt(0.06/12, 180, loan);
near(pay, 1341814, 2000, "PMT ผ่อนต่อเดือน");

// IRR ของกระแสเงินสดที่รู้คำตอบ: -100, +60 x2 -> 13.07%
near(irr([-100, 60, 60]), 0.1306623, 1e-5, "IRR กรณีตรวจสอบ");
near(npv(0.1306623, [-100, 60, 60]), 0, 1e-4, "NPV ที่ IRR = 0");

// ---- ตรวจโมเดลเทียบตัวเลขจากไฟล์ Excel (ชีต Log + สรุปผู้บริหาร) ----
const r = calc(DEFAULTS);
console.log("\n--- Base case (ค่าตั้งต้นเดียวกับ Excel) ---");
console.log("เงินลงทุนรวม      ", (r.tc/1e6).toFixed(2), "ลบ.");
console.log("NOI ปี 3          ", (r.noiStab/1e6).toFixed(2), "ลบ.");
console.log("Yield on Cost     ", (r.yoc*100).toFixed(2), "%");
console.log("Going-in Yield    ", (r.goingIn*100).toFixed(2), "%");
console.log("Unlevered IRR     ", (r.irrU*100).toFixed(2), "%");
console.log("Levered IRR       ", (r.irrL*100).toFixed(2), "%");
console.log("Equity Multiple   ", r.em.toFixed(2), "x");
console.log("DSCR ปี 1 / ปี 3  ", r.dscr1.toFixed(3), "/", r.rows[2].dscr.toFixed(3));
console.log("บอลลูนปี 10       ", (r.balloon/1e6).toFixed(2), "ลบ.");
console.log("ขายต่อสุทธิ        ", (r.exitNet/1e6).toFixed(2), "ลบ.");
console.log("Occ พอผ่อนหนี้     ", (r.occDebt*100).toFixed(1), "%");
console.log("จุดคุ้มทุน EBITDA  ", (r.beOcc*100).toFixed(1), "%\n");

near(r.tc/1e6,      272.65, 0.01, "เงินลงทุนรวม = 265x1.01+5");
near(r.yoc,         0.065,  0.003, "Yield on Cost ~6.5%");
near(r.irrL,        0.0665, 0.004, "Levered IRR ~6.65% (Log ข้อ 1)");
near(r.balloon/1e6, 69.4,   0.6,   "หนี้คงเหลือปี 10 ~69.4 ลบ. (Log ข้อ 1)");
near(r.dscr1,       0.951,  0.05,  "DSCR ปี 1 ต่ำกว่า 1.0 (สรุปผู้บริหาร)");

// ยอดสะสมผู้ถือหุ้นสิ้นปี 10 = 98.0 ลบ. (Log ข้อ 2)
const cum = r.rows.reduce((s, x) => s + x.cfL, 0) + r.cfL[0];
near(cum/1e6, 98.0, 1.5, "ยอดสะสมผู้ถือหุ้นปี 10 ~98 ลบ.");

// ราคาสูงสุด @ YoC 7.5% = 229.2 ลบ., ส่วนลด ~13.5% (Log ข้อ 4)
// เทียบสูตรตรงของ Excel: (NOI3/เป้า - workCap)/(1+dd%)
const pTarget = (r.noiStab/0.075 - DEFAULTS.workCap)/(1 + DEFAULTS.ddPct);
near(pTarget/1e6, 229.2, 1.5, "ราคาสูงสุด @ YoC 7.5% ~229 ลบ.");

// ---- ตรวจความสอดคล้องภายใน ----
const y3 = r.rows[2];
near(y3.rev, y3.roomRev*(1+DEFAULTS.fbPct), 1, "รายได้รวม = ห้อง x (1+F&B%)");
near(y3.noi, y3.ebitda - y3.reserve, 1, "NOI = EBITDA - สำรอง");
near(r.exitNet, (r.rows[9].noi/DEFAULTS.exitCap)*(1-DEFAULTS.saleCostPct), 1, "ขายต่อสุทธิ = NOI10/cap x (1-cost)");
assert(r.cfU.length === 11 && r.cfL.length === 11, "กระแสเงินสดต้องมี 11 จุด (ปี 0-10)");

// โหมดแยกต้นทุนคงที่/แปรผัน ต้องตรงกับโหมด % ที่ปีคงที่ (ปี 3) พอดี
const rs = calc({...DEFAULTS, opexMode:"split"});
near(rs.rows[2].opex, r.rows[2].opex, 2, "โหมด split ตรงกับ flat ที่ปี 3");
assert(rs.rows[0].ebitda < r.rows[0].ebitda, "โหมด split ต้องให้ EBITDA ปี 1 ต่ำกว่า (ต้นทุนคงที่ไม่ลดตาม occ)");
console.log("PASS  โหมด split กด EBITDA ปีแรกลง (operating leverage ทำงาน)");

// ทิศทาง sensitivity ต้องถูกต้อง
assert(calc({...DEFAULTS, price:200e6}).yoc  > r.yoc,  "ราคาถูกลง -> YoC สูงขึ้น");
assert(calc({...DEFAULTS, occ3:.75}).yoc     > r.yoc,  "occ สูงขึ้น -> YoC สูงขึ้น");
assert(calc({...DEFAULTS, rate:.07}).irrL    < r.irrL, "ดอกเบี้ยขึ้น -> Levered IRR ลง");
assert(calc({...DEFAULTS, exitCap:.09}).irrL < r.irrL, "exit cap ขึ้น -> Levered IRR ลง");
assert(calc({...DEFAULTS, citRate:.20}).irrL < r.irrL, "ใส่ภาษี -> IRR ลง");
assert(calc({...DEFAULTS, terminalMode:"forward"}).exitNet > r.exitNet, "forward NOI -> ขายต่อสูงขึ้น");
console.log("PASS  ทิศทาง sensitivity ทั้ง 6 ข้อถูกต้อง");

// กรณีขอบ: ไม่กู้เลย ต้องไม่พัง
const nl = calc({...DEFAULTS, ltv:0});
assert(nl.balloon === 0 && !isFinite(nl.dscr1) && isFinite(nl.irrL), "กรณี LTV=0 ต้องไม่พัง");
console.log("PASS  กรณีขอบ LTV = 0");

// ภาษี 20% ควรกด IRR ลง 1-2 จุด ตามที่ไฟล์ Excel ระบุ
const dIRR = (r.irrL - calc({...DEFAULTS, citRate:.20}).irrL)*100;
console.log(`INFO  CIT 20% ลด Levered IRR ลง ${dIRR.toFixed(2)} จุด (Excel ระบุ 1-2 จุด)`);

console.log(process.exitCode ? "\n*** มีข้อที่ไม่ผ่าน ***" : "\nครบทุกข้อ ✓");
