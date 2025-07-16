// ===== CSV 내보내기 관련 함수 csvExport.gs =====

// 중복 출고 체크 함수
function checkDuplicateExports(orderId, exportItems) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) return { hasDuplicates: false };
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 6) return { hasDuplicates: false };
    
    // 기존 데이터 읽기
    const data = sheet.getRange(7, 1, lastRow - 6, 17).getValues();
    const duplicates = [];
    
    // 내보내려는 항목 중 이미 출고된 항목 찾기
    exportItems.forEach(item => {
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === item.barcode && data[i][13]) { // 바코드 일치하고 이미 내보내기 시간이 있으면
          duplicates.push({
            barcode: item.barcode,
            name: item.name,
            exportedAt: data[i][13],
            currentRemaining: data[i][16] ? data[i][16] - (data[i][3] - data[i][16]) : 0
          });
        }
      }
    });
    
    return {
      hasDuplicates: duplicates.length > 0,
      duplicates: duplicates
    };
    
  } catch (error) {
    console.error('중복 체크 실패:', error);
    return { hasDuplicates: false };
  }
}

// CSV 내보내기 메인 함수
// csvExport.gs의 exportToCSV 함수 수정
function exportToCSV(orderId, exportItems) {
  console.log('exportToCSV 호출됨');
  console.log('orderId:', orderId);
  console.log('exportItems 수:', exportItems ? exportItems.length : 'null');
  
  try {
    if (!orderId || !exportItems || exportItems.length === 0) {
      console.log('유효성 검사 실패');
      return { success: false, message: '내보낼 항목이 없습니다.' };
    }
    
    console.log('CSV 데이터 생성 시작');
    // 1. CSV 데이터 생성
    const csvData = createCSVData(exportItems);
    console.log('CSV 데이터 생성 완료, 길이:', csvData.length);
    
    console.log('파일명 생성 시작');
    // 2. 파일명 생성
    const filename = generateCSVFilename(orderId);
    console.log('파일명:', filename);
    
    console.log('내보내기 이력 저장 시작');
    // 3. 내보내기 이력 저장
    const exportRecord = saveExportHistory(orderId, exportItems, filename);
    console.log('내보내기 이력 저장 완료');
    
    console.log('발주서 상태 업데이트 시작');
    console.log('exportItems 샘플:', exportItems.slice(0, 3));
    // 4. 발주서에 상태 업데이트
    updateOrderSheetExportStatus(orderId, exportItems, exportRecord);
    console.log('발주서 상태 업데이트 완료');
    
    // 추가 flush로 확실한 저장 보장
    SpreadsheetApp.flush();
    
    // 5. CSV 내용 반환 (클라이언트에서 다운로드)
    // Date 객체를 문자열로 변환
    const result = {
      success: true,
      csvContent: csvData,
      filename: filename,
      exportedCount: exportItems.length,
      exportedAt: exportRecord.exportedAt instanceof Date ? 
        exportRecord.exportedAt.toISOString() : 
        new Date().toISOString(),
      exportId: exportRecord.exportId || exportRecord.id || Utilities.getUuid(),
      // 내보낸 항목들의 정보 추가
      exportedItems: exportItems.map(item => ({
        id: item.id,
        barcode: item.barcode,
        exportedAt: exportRecord.exportedAt instanceof Date ? 
          exportRecord.exportedAt.toISOString() : 
          new Date().toISOString(),
        exportQuantity: item.exportQuantity || item.quantity
      }))
    };
    
    return result;
    
  } catch (error) {
    console.error('CSV 내보내기 실패:', error);
    console.error('에러 스택:', error.stack);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// CSV 데이터 생성
function createCSVData(items) {
  // BOM 추가 (엑셀에서 한글 깨짐 방지)
  let csv = '\uFEFF';
  
  // 헤더
  const headers = ['상품코드', '바코드', '상품명', '옵션값', '공급사상품명', '공급사명', '출고수량', '비고', '메모'];
  csv += headers.join(',') + '\n';
  
  // 데이터 행
  items.forEach(item => {
    const row = [
      '', // 상품코드 (빈값)
      item.barcode || '',
      escapeCSV(item.name || ''),
      escapeCSV(item.option || ''),
      '', // 공급사상품명 (빈값)
      escapeCSV(item.supplierName || ''),
      item.exportQuantity || item.quantity || 0, // 출고수량
      escapeCSV(item.memo || ''), // 비고
      escapeCSV(item.comment || '') // 메모
    ];
    
    csv += row.join(',') + '\n';
  });
  
  return csv;
}

// CSV 특수문자 이스케이프
function escapeCSV(str) {
  if (!str) return '';
  
  // 문자열로 변환
  str = String(str);
  
  // 쌍따옴표, 쉼표, 개행이 포함된 경우 처리
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    // 쌍따옴표는 두 개로 변환
    str = str.replace(/"/g, '""');
    // 전체를 쌍따옴표로 감싸기
    return `"${str}"`;
  }
  
  return str;
}

// 파일명 생성
function generateCSVFilename(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    // 발주처명 가져오기
    const recipientName = sheet.getRange(2, 2).getValue() || '발주처';
    
    // 날짜
    const now = new Date();
    const dateStr = Utilities.formatDate(now, 'GMT+9', 'yyMMdd');
    
    // 오늘 내보내기 차수 계산
    const todayExports = getTodayExportCount(orderId, dateStr);
    const exportNumber = todayExports + 1;
    
    // 파일명: 스재_yyMMdd_N차.csv
    return `스재_${dateStr}_${exportNumber}차.csv`;
    
  } catch (error) {
    // 에러 시 기본 파일명
    const dateStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyMMdd_HHmmss');
    return `스재_${dateStr}.csv`;
  }
}

// 오늘 내보내기 횟수 조회
function getTodayExportCount(orderId, dateStr) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    let historySheet = ss.getSheetByName('내보내기이력');
    
    if (!historySheet) {
      return 0;
    }
    
    const data = historySheet.getDataRange().getValues();
    let count = 0;
    
    // 오늘 날짜의 내보내기 횟수 계산
    for (let i = 1; i < data.length; i++) {
      const exportDate = data[i][1]; // 내보내기 일시
      if (exportDate && Utilities.formatDate(exportDate, 'GMT+9', 'yyMMdd') === dateStr) {
        count++;
      }
    }
    
    return count;
    
  } catch (error) {
    return 0;
  }
}

function saveExportHistory(orderId, items, filename) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    let historySheet = ss.getSheetByName('내보내기이력');
    
    // 이력 시트가 없으면 생성
    if (!historySheet) {
      historySheet = createExportHistorySheet(ss);
    }
    
    const now = new Date();
    const exportId = Utilities.getUuid();
    
    // 사용자 이메일 가져오기
    let userEmail = Session.getActiveUser().getEmail() || '알 수 없음';
    
    // 이력 데이터
    const historyData = [
      exportId,
      now, // Date 객체 그대로 사용
      userEmail,
      filename,
      items.length,
      items.slice(0, 10).map(i => i.barcode).join(', ') + (items.length > 10 ? '...' : ''),
      items.reduce((sum, i) => sum + (i.exportQuantity || i.quantity || 0), 0),
      '' // 상세 데이터
    ];
    
    // 이력 추가
    historySheet.appendRow(historyData);
    
    return {
      id: exportId,
      exportedAt: now, // Date 객체 반환
      exportedBy: userEmail
    };
    
  } catch (error) {
    console.error('내보내기 이력 저장 실패:', error);
    // 이력 저장 실패해도 내보내기는 계속 진행
    return {
      id: Utilities.getUuid(),
      exportedAt: new Date(), // Date 객체 반환
      exportedBy: '알 수 없음'
    };
  }
}

// 내보내기 이력 시트 생성
function createExportHistorySheet(spreadsheet) {
  const sheet = spreadsheet.insertSheet('내보내기이력');
  
  // 헤더 설정
  const headers = [
    'ID',
    '내보내기 일시',
    '작업자',
    '파일명',
    '항목 수',
    '바코드 목록',
    '총 수량',
    '상세 데이터'
  ];
  
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f0f0f0');
  
  // 컬럼 너비 조정
  sheet.setColumnWidth(1, 200); // ID
  sheet.setColumnWidth(2, 150); // 일시
  sheet.setColumnWidth(3, 150); // 작업자
  sheet.setColumnWidth(4, 150); // 파일명
  sheet.setColumnWidth(5, 80);  // 항목 수
  sheet.setColumnWidth(6, 300); // 바코드 목록
  sheet.setColumnWidth(7, 80);  // 총 수량
  sheet.setColumnWidth(8, 400); // 상세 데이터
  
  return sheet;
}

// 발주서 시트에 내보내기 상태 업데이트
function updateOrderSheetExportStatus(orderId, exportedItems, exportRecord) {
  try {
    console.log('=== updateOrderSheetExportStatus 시작 ===');
    console.log('orderId:', orderId);
    console.log('exportedItems 수:', exportedItems.length);
    console.log('첫번째 item 상세:', JSON.stringify(exportedItems[0]));
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      console.error('발주서 시트를 찾을 수 없습니다');
      return;
    }
    
    // 데이터 범위 가져오기
    const lastRow = sheet.getLastRow();
    if (lastRow <= 6) {
      console.log('데이터가 없습니다');
      return;
    }
    
    // 19열까지 읽기 (S열까지) - R, S열 포함
    const lastCol = sheet.getLastColumn();
    const numCols = Math.max(19, lastCol);
    const dataRange = sheet.getRange(7, 1, lastRow - 6, numCols);
    const values = dataRange.getValues();
    
    const exportTime = new Date();
    const exportTimeStr = Utilities.formatDate(exportTime, 'GMT+9', 'yyyy-MM-dd HH:mm:ss');
    
    // 바코드로만 매칭 (수량은 변경될 수 있으므로)
    const exportedBarcodes = new Set();
    const exportedItemsMap = new Map();
    
    exportedItems.forEach(item => {
      exportedBarcodes.add(String(item.barcode));
      exportedItemsMap.set(String(item.barcode), item);
      console.log('내보내기 항목:', {
        barcode: item.barcode,
        id: item.id,
        quantity: item.quantity,
        exportQuantity: item.exportQuantity
      });
    });
    
    // 업데이트할 데이터를 배치로 준비
    const batchUpdates = [];
    let updatedCount = 0;
    let matchedByBarcode = 0;
    
    for (let i = 0; i < values.length; i++) {
      const rowNum = 7 + i;
      const rowBarcode = String(values[i][0] || ''); // A열: 바코드
      
      // 빈 행은 건너뛰기
      if (!rowBarcode) {
        continue;
      }
      
      // 이미 내보낸 항목은 건너뛰기 (N열 확인)
      if (values[i][13]) {
        console.log(`행 ${rowNum} 건너뛰기 - 이미 내보냄: ${values[i][13]}`);
        continue;
      }
      
      // 바코드로 매칭
      if (exportedBarcodes.has(rowBarcode)) {
        console.log(`행 ${rowNum} 매칭 성공 - 바코드: ${rowBarcode}`);
        
        batchUpdates.push({
          row: rowNum,
          barcode: rowBarcode
        });
        
        updatedCount++;
        matchedByBarcode++;
        
        // 매칭된 항목 제거 (중복 방지)
        exportedBarcodes.delete(rowBarcode);
      }
    }
    
    console.log(`=== 업데이트 결과 ===`);
    console.log(`총 ${updatedCount}개 행 업데이트 예정`);
    console.log(`바코드 매칭: ${matchedByBarcode}개`);
    
    // 배치 업데이트 실행
    if (batchUpdates.length > 0) {
      console.log(`=== N, O열 업데이트 시작 ===`);
      console.log(`업데이트 행 수: ${batchUpdates.length}`);
      console.log(`내보내기 시간: ${exportTimeStr}`);
      
      // 방법 1: 개별 셀 업데이트 (더 안정적)
      let successCount = 0;
      let failCount = 0;
      
      for (let i = 0; i < batchUpdates.length; i++) {
        const update = batchUpdates[i];
        try {
          // N열(14번째): 내보내기 시간
          const nCell = sheet.getRange(update.row, 14);
          nCell.setNumberFormat('@'); // 텍스트 형식으로 먼저 설정
          nCell.setValue(exportTimeStr);
          
          // O열(15번째): CSV 확인
          const oCell = sheet.getRange(update.row, 15);
          oCell.setValue('✓');
          
          successCount++;
          
          // 10개마다 저장
          if (successCount % 10 === 0) {
            SpreadsheetApp.flush();
            console.log(`${successCount}개 업데이트 완료...`);
          }
        } catch (e) {
          failCount++;
          console.error(`행 ${update.row} 업데이트 실패:`, e);
        }
      }
      
      // 최종 저장
      SpreadsheetApp.flush();
      console.log(`업데이트 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
      
      // 대체 방법: 범위로 한 번에 업데이트
      if (failCount > 0) {
        console.log('실패한 항목 재시도...');
        try {
          // 모든 업데이트 행의 N, O열을 한 번에 가져오기
          const minRow = Math.min(...batchUpdates.map(u => u.row));
          const maxRow = Math.max(...batchUpdates.map(u => u.row));
          const range = sheet.getRange(minRow, 14, maxRow - minRow + 1, 2);
          const values = range.getValues();
          
          // 업데이트할 행에만 값 설정
          batchUpdates.forEach(update => {
            const rowIndex = update.row - minRow;
            values[rowIndex][0] = exportTimeStr; // N열
            values[rowIndex][1] = '✓'; // O열
          });
          
          // 한 번에 설정
          range.setValues(values);
          SpreadsheetApp.flush();
          console.log('범위 업데이트 완료');
        } catch (e) {
          console.error('범위 업데이트도 실패:', e);
        }
      }
      
      // 추가 안정성을 위한 지연
      Utilities.sleep(1000);
      SpreadsheetApp.flush();
      
      // 업데이트 확인을 위해 다시 읽기
      console.log('=== 업데이트 검증 시작 ===');
      const verifyRange = sheet.getRange(7, 14, lastRow - 6, 2);
      const verifyValues = verifyRange.getValues();
      let verifiedCount = 0;
      let nColumnEmpty = 0;
      let oColumnEmpty = 0;
      
      // 업데이트된 행만 확인
      batchUpdates.forEach(update => {
        const rowIndex = update.row - 7;
        if (rowIndex >= 0 && rowIndex < verifyValues.length) {
          const nValue = String(verifyValues[rowIndex][0] || '').trim();
          const oValue = String(verifyValues[rowIndex][1] || '').trim();
          
          if (nValue === exportTimeStr && oValue === '✓') {
            verifiedCount++;
          } else {
            if (!nValue) nColumnEmpty++;
            if (!oValue) oColumnEmpty++;
            console.log(`행 ${update.row}: N열="${nValue}", O열="${oValue}"`);
          }
        }
      });
      
      console.log(`검증 결과: ${verifiedCount}/${batchUpdates.length}개 정상 업데이트`);
      if (nColumnEmpty > 0) console.log(`N열 비어있음: ${nColumnEmpty}개`);
      if (oColumnEmpty > 0) console.log(`O열 비어있음: ${oColumnEmpty}개`);
    } else {
      console.error('⚠️ 업데이트된 항목이 없습니다!');
      console.log('매칭 실패한 바코드들:', Array.from(exportedBarcodes));
    }
    
    // 헤더 확인 및 추가 (19열까지)
    const headers = sheet.getRange(6, 1, 1, 19).getValues()[0];
    
    // N열 헤더 설정
    if (!headers[13] || headers[13] === '') {
      sheet.getRange(6, 14).setValue('내보내기시간');
      sheet.getRange(6, 14).setFontWeight('bold');
      sheet.getRange(6, 14).setBackground('#f0f0f0');
    }
    
    // O열 헤더 설정
    if (!headers[14] || headers[14] === '') {
      sheet.getRange(6, 15).setValue('CSV확인');
      sheet.getRange(6, 15).setFontWeight('bold');
      sheet.getRange(6, 15).setBackground('#f0f0f0');
    }
    
    // P열 헤더 설정
    if (!headers[15] || headers[15] === '') {
      sheet.getRange(6, 16).setValue('박스번호');
      sheet.getRange(6, 16).setFontWeight('bold');
      sheet.getRange(6, 16).setBackground('#f0f0f0');
    }
    
    // Q열 헤더는 이미 '출고가능수량'으로 설정되어 있으므로 변경하지 않음
    // Q열은 출고가능수량을 표시하는 열이며, CSV 내보내기 시에도 유지됨
    
  } catch (error) {
    console.error('발주서 상태 업데이트 실패:', error);
    // 에러가 발생해도 계속 진행
  }
}

// 내보내기 이력 조회
function getExportHistory(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const historySheet = ss.getSheetByName('내보내기이력');
    
    if (!historySheet) {
      return [];
    }
    
    const data = historySheet.getDataRange().getValues();
    const history = [];
    
    // 최근 10개만 반환 (역순)
    for (let i = Math.max(1, data.length - 10); i < data.length; i++) {
      if (data[i][0]) {
        history.unshift({
          id: data[i][0],
          exportedAt: data[i][1],
          exportedBy: data[i][2],
          filename: data[i][3],
          itemCount: data[i][4]
        });
      }
    }
    
    return history;
    
  } catch (error) {
    console.error('내보내기 이력 조회 실패:', error);
    return [];
  }
}

// 내보내기 상태 초기화
function resetExportStatus(orderId) {
  try {
    if (!orderId) {
      return { success: false, message: '발주서 ID가 필요합니다.' };
    }
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서를 찾을 수 없습니다.' };
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 6) {
      return { success: true, message: '초기화할 항목이 없습니다.' };
    }
    
    // N열(14열)과 O열(15열) 초기화 - 내보내기 시간과 상태
    const exportTimeRange = sheet.getRange(7, 14, lastRow - 6, 1);
    const exportStatusRange = sheet.getRange(7, 15, lastRow - 6, 1);
    
    // 빈 값으로 초기화
    exportTimeRange.clearContent();
    exportStatusRange.clearContent();
    
    // 내보내기 이력도 초기화 (선택적)
    const historySheet = ss.getSheetByName('내보내기이력');
    if (historySheet) {
      const historyLastRow = historySheet.getLastRow();
      if (historyLastRow > 1) {
        // 헤더를 제외한 모든 데이터 삭제
        historySheet.deleteRows(2, historyLastRow - 1);
      }
    }
    
    // 메타데이터 업데이트
    const now = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(4, 11).setValue('초기화:').setFontWeight('bold');
    sheet.getRange(4, 12).setValue(now);
    
    return { 
      success: true, 
      message: '내보내기 상태가 초기화되었습니다.',
      clearedCount: lastRow - 6
    };
    
  } catch (error) {
    console.error('내보내기 상태 초기화 실패:', error);
    return { 
      success: false, 
      message: '초기화 중 오류가 발생했습니다: ' + error.toString() 
    };
  }
}

// N열 업데이트 디버그 함수
function debugUpdateExportTime(orderId, barcode, exportTime) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서를 찾을 수 없습니다.' };
    }
    
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(7, 1, lastRow - 6, 1).getValues();
    
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(barcode)) {
        const row = 7 + i;
        const nCell = sheet.getRange(row, 14);
        
        console.log(`행 ${row}에서 바코드 ${barcode} 찾음`);
        console.log(`현재 N열 값: "${nCell.getValue()}"`);
        console.log(`현재 형식: ${nCell.getNumberFormat()}`);
        
        // 텍스트 형식으로 설정
        nCell.setNumberFormat('@');
        nCell.setValue(exportTime || new Date().toISOString());
        SpreadsheetApp.flush();
        
        // 다시 읽기
        const newValue = nCell.getValue();
        console.log(`업데이트 후 N열 값: "${newValue}"`);
        
        return {
          success: true,
          row: row,
          oldValue: data[i][13] || '',
          newValue: newValue
        };
      }
    }
    
    return { success: false, message: '바코드를 찾을 수 없습니다.' };
  } catch (error) {
    console.error('디버그 업데이트 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 내보내기 가능 여부 확인 (API 호출 최적화)
function validateExportItems(orderId, itemIds) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서를 찾을 수 없습니다.' };
    }
    
    // 한 번에 모든 데이터 읽기
    const lastRow = sheet.getLastRow();
    if (lastRow <= 6) {
      return { success: false, message: '발주 항목이 없습니다.' };
    }
    
    const dataRange = sheet.getRange(7, 1, lastRow - 6, 14);
    const values = dataRange.getValues();
    
    const validation = {
      validItems: [],
      invalidItems: [],
      warnings: []
    };
    
    // 각 항목 검증
    values.forEach((row, index) => {
      const barcode = String(row[0]);
      const status = row[9]; // 상태
      const stockStatus = row[11]; // 재고가능여부
      const exportStatus = row[13]; // 내보내기 상태
      
      // itemIds가 제공된 경우 해당 항목만 검증
      if (itemIds && !itemIds.includes(barcode)) {
        return;
      }
      
      const item = {
        barcode: barcode,
        name: row[1],
        status: status,
        stockStatus: stockStatus,
        exportStatus: exportStatus,
        rowIndex: 7 + index
      };
      
      // 검증 로직
      if (status !== '확정') {
        validation.invalidItems.push({
          ...item,
          reason: '미확정 상태'
        });
      } else if (!stockStatus || stockStatus === '미확인') {
        validation.invalidItems.push({
          ...item,
          reason: '재고 미확인'
        });
      } else if (stockStatus === '품절' || stockStatus === '오더중') {
        validation.invalidItems.push({
          ...item,
          reason: stockStatus
        });
      } else {
        validation.validItems.push(item);
        
        if (exportStatus && exportStatus.includes('내보내기 완료')) {
          validation.warnings.push({
            ...item,
            warning: '이미 내보내기됨'
          });
        }
      }
    });
    
    return {
      success: true,
      validation: validation
    };
    
  } catch (error) {
    console.error('항목 검증 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}
