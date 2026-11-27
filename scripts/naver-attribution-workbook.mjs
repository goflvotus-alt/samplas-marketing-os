import ExcelJS from 'exceljs';

const columns = [
  ['spend', '광고비'], ['impressions', '노출'], ['clicks', '클릭'], ['ctr', 'CTR'], ['cpc', 'CPC'],
  ['orders', '귀속 주문'], ['paid', '실결제'], ['refund', '취소·환불'], ['net', '순매출'],
  ['roas', '실매출 ROAS'], ['platformRevenue', '네이버 전환금액'], ['newCustomers', '신규 고객'],
  ['repeatCustomers', '재구매 고객'], ['trackingStatus', '추적 상태'], ['adStatus', '광고 통계 상태']
];

export async function buildNaverAttributionWorkbook(report) {
  const book = new ExcelJS.Workbook();
  function sheet(name, headings, rows) {
    const ws = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(headings);
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach(column => { column.width = 19; });
    return ws;
  }
  const measures = row => columns.map(([key]) => row?.[key] ?? null);
  const summary = sheet('성과 요약', ['기간', '시작', '종료', ...columns.map(([, title]) => title)], [
    ['선택', report.period.since, report.period.until, ...measures(report.totals)],
    ['직전', report.comparison.since, report.comparison.until, ...measures(report.previous)]
  ]);
  summary.addRow(['귀속 기준', report.attributionBasis]);
  summary.addRow(['갱신 시각', report.generatedAt]);
  for (const [name, rows] of [['기간별', report.rows], ['직전 기간별', report.comparisonRows], ['브랜드별', report.brandRows]]) {
    sheet(name, ['기간 또는 브랜드', '시작', '종료', ...columns.map(([, title]) => title)],
      (rows || []).map(row => [row.label, row.since, row.until, ...measures(row)]));
  }
  sheet('주문 근거', ['주문번호', '일자', '유입 브랜드', '구매 브랜드', '실결제', '취소·환불', '순매출', '고객 구분', '상태'],
    report.orders.map(order => [order.orderId, order.day, order.acquisitionBrand, order.purchaseBrands.join(', '),
      order.paid, order.refund, order.net, order.customerType, order.status]));
  sheet('구매 상품', ['주문번호', '상품', '수량', '구매 브랜드'],
    report.orders.flatMap(order => order.items.map(item => [order.orderId, item.name, item.quantity, item.brand])));
  return book.xlsx.writeBuffer();
}
