// ===== 데이터 처리 최적화 dataHandler.gs ===== 

// 상품 데이터를 청크로 나누어 로드
function loadProductsOptimized() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    
    if (!sheet) {
      throw new Error('시트를 찾을 수 없습니다: ' + CONFIG.PRODUCT_SHEET_NAME);
    }
    
    // 전체 행 수 확인
    const lastRow = sheet.getLastRow();
    console.log(`총 ${lastRow - 1}개 상품 데이터 발견`);
    
    // 데이터 범위 가져오기 (A~K열만)
    const dataRange = sheet.getRange(2, 1, lastRow - 1, 11); // 헤더 제외
    const data = dataRange.getValues();
    
    // 필요한 데이터만 추출 (메모리 최적화)
    const products = [];
    
    for (let i = 0; i < data.length; i++) {
      if (data[i][0]) { // 바코드가 있는 경우만
        // 필수 데이터만 포함
        products.push({
          barcode: String(data[i][0]),
          name: data[i][1] || '',
          option: data[i][2] || '',
          price: data[i][9] || 0,
          supplier: data[i][4] || '',
          // 검색에 사용할 텍스트 결합
          searchText: `${data[i][0]} ${data[i][1]} ${data[i][2]}`.toLowerCase()
        });
      }
    }
    
    console.log(`${products.length}개 상품 처리 완료`);
    return products;
    
  } catch (error) {
    console.error('상품 로드 실패:', error);
    throw new Error('상품 데이터를 불러올 수 없습니다: ' + error.toString());
  }
}
