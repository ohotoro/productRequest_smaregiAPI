// ===== CSV 내보내기 관련 함수 csvExport.gs =====

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
    // 4. 발주서에 상태 업데이트
    updateOrderSheetExportStatus(orderId, exportItems, exportRecord);
    console.log('발주서 상태 업데이트 완료');
    
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
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) return;
    
    // 데이터 범위 가져오기
    const lastRow = sheet.getLastRow();
    if (lastRow <= 6) return;
    
    // 17열까지 읽기 (Q열까지)
    const dataRange = sheet.getRange(7, 1, lastRow - 6, 17);
    const values = dataRange.getValues();
    
    const exportTime = new Date();
    const exportTimeStr = Utilities.formatDate(exportTime, 'GMT+9', 'yyyy-MM-dd HH:mm:ss');
    
    // 내보낸 항목들의 바코드 맵 생성
    const exportedMap = new Map();
    exportedItems.forEach(item => {
      exportedMap.set(item.barcode, {
        ...item,
        actualExportQty: item.exportQuantity || item.quantity
      });
    });
    
    // 각 행 업데이트
    for (let i = 0; i < values.length; i++) {
      const barcode = String(values[i][0]);
      
      if (exportedMap.has(barcode)) {
        const exportedItem = exportedMap.get(barcode);
        const rowNum = 7 + i;
        
        // N열(14번째): 내보내기 시간
        sheet.getRange(rowNum, 14).setValue(exportTimeStr);
        
        // O열(15번째): CSV 확인
        sheet.getRange(rowNum, 15).setValue('✓');
        
        // Q열(17번째): 실제출고수량 - 새로 추가
        sheet.getRange(rowNum, 17).setValue(exportedItem.actualExportQty);
        
        // 셀 포맷 설정
        sheet.getRange(rowNum, 14).setNumberFormat('@'); // 텍스트 형식
        sheet.getRange(rowNum, 15).setHorizontalAlignment('center'); // 가운데 정렬
        sheet.getRange(rowNum, 17).setNumberFormat('0'); // 숫자 형식
      }
    }
    
    // 헤더 확인 및 추가
    const headers = sheet.getRange(6, 1, 1, 17).getValues()[0];
    
    if (headers[13] !== '내보내기시간' && headers[13] === '') {
      sheet.getRange(6, 14).setValue('내보내기시간');
      sheet.getRange(6, 14).setFontWeight('bold');
      sheet.getRange(6, 14).setBackground('#f0f0f0');
    }
    
    if (headers[14] !== 'CSV확인' && headers[14] === '') {
      sheet.getRange(6, 15).setValue('CSV확인');
      sheet.getRange(6, 15).setFontWeight('bold');
      sheet.getRange(6, 15).setBackground('#f0f0f0');
    }
    
    if (headers[15] !== '박스번호' && headers[15] === '') {
      sheet.getRange(6, 16).setValue('박스번호');
      sheet.getRange(6, 16).setFontWeight('bold');
      sheet.getRange(6, 16).setBackground('#f0f0f0');
    }
    
    // Q열 헤더 추가
    if (headers[16] !== '실제출고수량' && headers[16] === '') {
      sheet.getRange(6, 17).setValue('실제출고수량');
      sheet.getRange(6, 17).setFontWeight('bold');
      sheet.getRange(6, 17).setBackground('#f0f0f0');
    }
    
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