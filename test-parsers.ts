// Ad-hoc CSV parser test (run: `node test-parsers.ts`). Uses the EXACT exported
// header rows (typos preserved) and checks amount→paise, refund/success detection,
// comma-bearing names, date-window inference, and header-shape rejection.

import { parseGatewayCsv, parseUpiCsv, parseRupeesToPaise } from "./lib/reconciliation/parsers.ts";

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

const GW_HEADERS =
  "Merchant ID,Transaction ID,Invoice Number,RRN,Transaction Date,Transaction Amount,Transaction Charges,Merchant Reference No,Payment Mode,Sub Payment Mode,Payment Instrument ID,Card Scheme,Card Category,Region,Transaction Status,Response Description,Transaction Type,Reconciliation Status,Customer Email ID,Customer Mobile Number,Customer Name,Additional Parameter 1,Additional Parameter 2,User ID,Original Transaction ID,Sgst,Cgst,Igst,DCC Amount,Pre-Auth Status,Auth Due Date";

// 31 columns each. Customer Name in row 1 has a comma → must be quoted.
const gwRow = (vals: Record<string, string>) => {
  const cols = GW_HEADERS.split(",");
  return cols
    .map((c) => {
      const v = vals[c] ?? "";
      return v.includes(",") ? `"${v}"` : v;
    })
    .join(",");
};

const gwCsv = [
  GW_HEADERS,
  gwRow({
    "Transaction ID": "GW1",
    "Transaction Amount": "4,000.00",
    "Transaction Charges": "20.00",
    "Transaction Status": "SUCCESS",
    "Transaction Type": "SALE",
    "Customer Name": "Doe, John",
    "Customer Mobile Number": "9876543210",
    "Transaction Date": "01-06-2026 10:30:00",
    RRN: "RRNX",
  }),
  gwRow({
    "Transaction ID": "GW2",
    "Transaction Amount": "1000",
    "Transaction Status": "SUCCESS",
    "Transaction Type": "REFUND",
    "Original Transaction ID": "GW-ORIG",
    "Transaction Date": "02-06-2026 09:00:00",
  }),
].join("\n");

{
  const r = parseGatewayCsv(gwCsv);
  check(r.ok, "gateway: header ok");
  check(r.rows.length === 2, "gateway: 2 rows");
  const g1 = r.rows.find((x) => x.transactionId === "GW1")!;
  check(g1.amountPaise === 400000, "gateway: ₹4,000.00 → 400000 paise");
  check(g1.chargesPaise === 2000, "gateway: charges ₹20 → 2000 paise");
  check(g1.netAmountPaise === 398000, "gateway: net = amount − charges");
  check(g1.isSuccess && !g1.isRefund, "gateway: GW1 success, not refund");
  check(g1.customerName === "Doe, John", "gateway: comma-bearing name preserved");
  check(g1.customerMobile === "9876543210", "gateway: customer mobile parsed");
  const g2 = r.rows.find((x) => x.transactionId === "GW2")!;
  check(g2.isRefund && !g2.isSuccess, "gateway: GW2 refund (Original Transaction ID) → isRefund");
  check(g2.originalTransactionId === "GW-ORIG", "gateway: refund back-pointer captured");
  check(!!r.minDate && !!r.maxDate && r.minDate < r.maxDate, "gateway: date window inferred");
}

// Header-shape mismatch rejects the whole file.
{
  const bad = "Merchant ID,Invoice Number,RRN\nM1,INV1,RRN1";
  const r = parseGatewayCsv(bad);
  check(!r.ok, "gateway: missing required headers → rejected");
  check(r.missingHeaders.includes("Transaction ID"), "gateway: reports missing Transaction ID");
}

const UPI_HEADERS =
  "merchantTranId,bankRRN,dateTime,amount,subMerchantId,billNo,customerVPA,status,transcationType,actCode,actMessage,merchantId,apiMandateUmn,refundStstus,rechargeStatus,txnCompletationDate,Contact Numbers,Name,Date";

const upiRow = (vals: Record<string, string>) => {
  const cols = UPI_HEADERS.split(",");
  return cols
    .map((c) => {
      const v = vals[c] ?? "";
      return v.includes(",") ? `"${v}"` : v;
    })
    .join(",");
};

const upiCsv = [
  UPI_HEADERS,
  upiRow({
    merchantTranId: "UP1",
    bankRRN: "RRN1",
    amount: "1008",
    status: "SUCCESS",
    transcationType: "PAY",
    customerVPA: "jane@upi",
    "Contact Numbers": "9988776655",
    Name: "Smith, Jane",
    txnCompletationDate: "03-06-2026 12:00:00",
  }),
  upiRow({
    merchantTranId: "UP2",
    bankRRN: "RRN2",
    amount: "1000",
    status: "SUCCESS",
    transcationType: "REFUND",
    refundStstus: "SUCCESS",
  }),
].join("\n");

{
  const r = parseUpiCsv(upiCsv);
  check(r.ok, "upi: header ok");
  check(r.rows.length === 2, "upi: 2 rows");
  const u1 = r.rows.find((x) => x.merchantTranId === "UP1")!;
  check(u1.amountPaise === 100800, "upi: ₹1008 → 100800 paise (overpay captured)");
  check(u1.bankRRN === "RRN1", "upi: bankRRN match key parsed");
  check(u1.isSuccess && !u1.isRefund, "upi: UP1 success");
  check(u1.payerName === "Smith, Jane", "upi: comma-bearing payer name preserved");
  check(u1.contactNumber === "9988776655", "upi: contact number parsed");
  const u2 = r.rows.find((x) => x.merchantTranId === "UP2")!;
  check(u2.isRefund && !u2.isSuccess, "upi: UP2 refundStstus=SUCCESS → isRefund");
}

{
  const bad = "merchantTranId,amount,status\nX,1000,SUCCESS"; // missing bankRRN
  const r = parseUpiCsv(bad);
  check(!r.ok, "upi: missing bankRRN → rejected");
  check(r.missingHeaders.includes("bankRRN"), "upi: reports missing bankRRN");
}

// Spot-check the paise helper.
check(parseRupeesToPaise("₹1,008.50") === 100850, "paise: ₹1,008.50 → 100850");
check(parseRupeesToPaise("") === 0, "paise: empty → 0");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✓ all parser assertions passed");
