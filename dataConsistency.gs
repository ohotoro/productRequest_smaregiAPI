// ===== 데이터 일관성 관리 dataConsistency.gs =====

// 자동 동기화 트리거 설정
function setupDataConsistencyTriggers() {
  // 기존 트리거 제거
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoSyncData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 30분마다 자동 동기화
  ScriptApp.newTrigger('autoSyncData')
    .timeBased()
    .everyMinutes(30)
    .create();
    
  // 매일 오전 6시 전체 검증
  ScriptApp.newTrigger('dailyDataValidation')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
}

// 자동 동기화 함수
function autoSyncData() {
  try {
    const currentOrder = getCurrentOrder();
    if (!currentOrder || !currentOrder.orderId) {
      console.log('활성 발주서 없음');
      return;
    }
    
    // 동기화 실행
    const result = syncAllSheets(currentOrder.orderId);
    
    // 불일치 발견 시 알림
    if (result.discrepancies > 0) {
      sendDataInconsistencyAlert(result);
    }
    
    // 로그 기록
    logSyncResult(result);
    
  } catch (error) {
    console.error('자동 동기화 실패:', error);
  }
}

// 전체 시트 동기화
function syncAllSheets(orderId) {
  if (!orderId) {
    const currentOrder = getCurrentOrder();
    if (!currentOrder || !currentOrder.orderId) {
      return {
        timestamp: new Date(),
        orderId: null,
        discrepancies: 0,
        corrections: 0,
        errors: ['활성 발주서 없음']
      };
    }
    orderId = currentOrder.orderId;
  }
  
  const ss = SpreadsheetApp.openById(orderId);
  const orderSheet = ss.getSheetByName('발주서');
  const historySheet = ss.getSheetByName('출고이력');
  const packingSheet = ss.getSheetByName('패킹리스트');
  
  const result = {
    timestamp: new Date(),
    orderId: orderId,
    discrepancies: 0,
    corrections: 0,
    errors: []
  };
  
  if (!orderSheet || !historySheet) {
    result.errors.push('필수 시트 없음');
    return result;
  }
  
  // 1. 출고이력 데이터를 Truth로 수집
  const truthData = collectTruthData(historySheet);
  
  // 2. 발주서 P열 데이터와 비교
  const orderData = collectOrderSheetData(orderSheet);
  
  // 3. 불일치 항목 찾기
  const discrepancies = findDiscrepancies(truthData, orderData);
  result.discrepancies = discrepancies.length;
  
  // 4. 자동 수정 가능한 항목 처리
  if (discrepancies.length > 0) {
    const corrections = autoCorrectDiscrepancies(orderSheet, discrepancies, truthData);
    result.corrections = corrections;
  }
  
  // 5. 기존 syncWithPackingList 함수 호출하여 전체 동기화
  try {
    syncWithPackingList(orderId);
  } catch (e) {
    result.errors.push('패킹리스트 동기화 실패: ' + e.toString());
  }
  
  return result;
}

// Truth 데이터 수집 (출고이력 기준)
function collectTruthData(historySheet) {
  const truthData = {};
  
  if (historySheet.getLastRow() <= 1) return truthData;
  
  const data = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, 8).getValues();
  
  data.forEach(row => {
    const [timestamp, boxNumber, barcode, name, option, quantity, operator, rowNum] = row;
    
    if (!barcode) return;
    
    if (!truthData[barcode]) {
      truthData[barcode] = {
        totalQuantity: 0,
        boxes: {},
        lastUpdate: timestamp
      };
    }
    
    const box = String(boxNumber).replace(/[^0-9]/g, '');
    const qty = parseInt(quantity) || 0;
    
    if (!truthData[barcode].boxes[box]) {
      truthData[barcode].boxes[box] = 0;
    }
    
    truthData[barcode].boxes[box] += qty;
    truthData[barcode].totalQuantity += qty;
    
    if (timestamp > truthData[barcode].lastUpdate) {
      truthData[barcode].lastUpdate = timestamp;
    }
  });
  
  return truthData;
}

// 발주서 데이터 수집
function collectOrderSheetData(orderSheet) {
  const orderData = {};
  const lastRow = orderSheet.getLastRow();
  
  if (lastRow <= 6) return orderData;
  
  const data = orderSheet.getRange(7, 1, lastRow - 6, 19).getValues();
  
  data.forEach((row, index) => {
    const barcode = String(row[0]);
    const boxNumbers = String(row[15] || ''); // P열
    const shippingStatus = String(row[17] || ''); // R열
    
    if (!barcode) return;
    
    orderData[barcode] = {
      rowIndex: 7 + index,
      boxNumbers: boxNumbers,
      status: shippingStatus,
      parsedBoxes: parseBoxNumbersToMap(boxNumbers)
    };
  });
  
  return orderData;
}

// 박스번호 문자열을 맵으로 파싱
function parseBoxNumbersToMap(boxNumbers) {
  const boxMap = {};
  
  if (!boxNumbers) return boxMap;
  
  const matches = boxNumbers.match(/(\d+)\((\d+)\)/g);
  if (matches) {
    matches.forEach(match => {
      const [, box, qty] = match.match(/(\d+)\((\d+)\)/);
      boxMap[box] = parseInt(qty);
    });
  }
  
  return boxMap;
}

// 불일치 항목 찾기
function findDiscrepancies(truthData, orderData) {
  const discrepancies = [];
  
  // Truth 데이터 기준으로 검사
  Object.keys(truthData).forEach(barcode => {
    const truth = truthData[barcode];
    const order = orderData[barcode];
    
    if (!order) {
      // 출고이력에는 있지만 발주서에 없음
      discrepancies.push({
        type: 'MISSING_IN_ORDER',
        barcode: barcode,
        truthData: truth
      });
      return;
    }
    
    // 박스별 수량 비교
    const truthBoxes = truth.boxes;
    const orderBoxes = order.parsedBoxes;
    
    // 박스 불일치 확인
    Object.keys(truthBoxes).forEach(box => {
      if (!orderBoxes[box] || orderBoxes[box] !== truthBoxes[box]) {
        discrepancies.push({
          type: 'BOX_QUANTITY_MISMATCH',
          barcode: barcode,
          box: box,
          truthQuantity: truthBoxes[box],
          orderQuantity: orderBoxes[box] || 0,
          rowIndex: order.rowIndex
        });
      }
    });
    
    // 총 수량 검증
    const orderTotal = Object.values(orderBoxes).reduce((sum, qty) => sum + qty, 0);
    if (orderTotal !== truth.totalQuantity) {
      discrepancies.push({
        type: 'TOTAL_QUANTITY_MISMATCH',
        barcode: barcode,
        truthTotal: truth.totalQuantity,
        orderTotal: orderTotal,
        rowIndex: order.rowIndex
      });
    }
  });
  
  return discrepancies;
}

// 자동 수정 가능한 불일치 처리
function autoCorrectDiscrepancies(orderSheet, discrepancies, truthData) {
  let corrections = 0;
  const protectedStatuses = ['출고완료'];
  
  discrepancies.forEach(disc => {
    // 보호된 상태는 수정하지 않음
    if (disc.rowIndex) {
      const status = orderSheet.getRange(disc.rowIndex, 18).getValue();
      if (protectedStatuses.includes(status)) {
        return;
      }
    }
    
    switch (disc.type) {
      case 'BOX_QUANTITY_MISMATCH':
      case 'TOTAL_QUANTITY_MISMATCH':
        // Truth 데이터로 P열 업데이트
        if (disc.rowIndex && truthData[disc.barcode]) {
          const newBoxNumbers = formatBoxNumbers(truthData[disc.barcode].boxes);
          orderSheet.getRange(disc.rowIndex, 16).setValue(newBoxNumbers);
          corrections++;
        }
        break;
      case 'MISSING_IN_ORDER':
        // 발주서에 없는 항목은 로그만 기록
        console.log(`발주서에 없는 출고 항목: ${disc.barcode}`);
        break;
    }
  });
  
  if (corrections > 0) {
    SpreadsheetApp.flush();
  }
  
  return corrections;
}

// 박스 번호 포맷팅
function formatBoxNumbers(boxMap) {
  return Object.entries(boxMap)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([box, qty]) => `${box}(${qty})`)
    .join(', ');
}

// 데이터 불일치 알림
function sendDataInconsistencyAlert(result) {
  // 이메일 또는 시트에 로그 기록
  const alertSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('데이터검증로그');
  
  if (!alertSheet) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const newSheet = ss.insertSheet('데이터검증로그');
    newSheet.getRange(1, 1, 1, 5).setValues([['타임스탬프', '불일치 건수', '자동 수정', '수동 확인 필요', '상세내용']]);
  }
  
  alertSheet.appendRow([
    result.timestamp,
    result.discrepancies,
    result.corrections,
    result.discrepancies - result.corrections,
    JSON.stringify(result.errors)
  ]);
}

// 동기화 결과 로깅
function logSyncResult(result) {
  console.log('데이터 동기화 완료:', {
    시간: result.timestamp,
    불일치: result.discrepancies,
    수정: result.corrections,
    오류: result.errors.length
  });
}

// 일일 데이터 검증
function dailyDataValidation() {
  const currentOrder = getCurrentOrder();
  if (!currentOrder) return;
  
  const ss = SpreadsheetApp.openById(currentOrder.orderId);
  const validationResult = {
    date: new Date(),
    checks: [],
    issues: []
  };
  
  // 1. 시트 존재 확인
  const requiredSheets = ['발주서', '출고이력', '패킹리스트'];
  requiredSheets.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    validationResult.checks.push({
      check: `${sheetName} 시트 존재`,
      result: sheet ? 'PASS' : 'FAIL'
    });
  });
  
  // 2. 데이터 무결성 검사
  const integrityCheck = validateDataIntegrity(ss);
  validationResult.checks.push(...integrityCheck.checks);
  validationResult.issues.push(...integrityCheck.issues);
  
  // 3. 검증 보고서 생성
  createValidationReport(ss, validationResult);
}

// 데이터 무결성 검증
function validateDataIntegrity(spreadsheet) {
  const result = {
    checks: [],
    issues: []
  };
  
  const orderSheet = spreadsheet.getSheetByName('발주서');
  const historySheet = spreadsheet.getSheetByName('출고이력');
  
  if (!orderSheet || !historySheet) return result;
  
  // 1. P열과 R열 일관성 검사
  const orderData = orderSheet.getRange(7, 1, orderSheet.getLastRow() - 6, 19).getValues();
  
  orderData.forEach((row, index) => {
    const boxNumbers = row[15]; // P열
    const status = row[17]; // R열
    const exportableQty = row[16]; // Q열
    
    // P열에 값이 있으면 R열도 있어야 함
    if (boxNumbers && !status) {
      result.issues.push({
        row: 7 + index,
        issue: 'P열 데이터 있지만 R열 상태 없음',
        severity: 'HIGH'
      });
    }
    
    // 출고완료 상태인데 P열이 비어있음
    if (status === '출고완료' && !boxNumbers) {
      result.issues.push({
        row: 7 + index,
        issue: '출고완료 상태인데 박스번호 없음',
        severity: 'HIGH'
      });
    }
  });
  
  result.checks.push({
    check: 'P열-R열 일관성',
    result: result.issues.length === 0 ? 'PASS' : 'FAIL',
    issueCount: result.issues.length
  });
  
  return result;
}

// 검증 보고서 생성
function createValidationReport(spreadsheet, validationResult) {
  let reportSheet = spreadsheet.getSheetByName('검증보고서');
  
  if (!reportSheet) {
    reportSheet = spreadsheet.insertSheet('검증보고서');
    reportSheet.getRange(1, 1, 1, 4).setValues([['검증일시', '검사항목', '결과', '이슈']]);
  }
  
  const reportData = [];
  validationResult.checks.forEach(check => {
    reportData.push([
      validationResult.date,
      check.check,
      check.result,
      check.issueCount || 0
    ]);
  });
  
  if (reportData.length > 0) {
    reportSheet.getRange(reportSheet.getLastRow() + 1, 1, reportData.length, 4).setValues(reportData);
  }
}

// 수동 데이터 복구 UI 함수
function showDataRecoveryDialog() {
  const html = HtmlService.createHtmlOutputFromFile('dataRecovery')
    .setWidth(600)
    .setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, '데이터 복구 도구');
}

// 특정 항목 수동 복구
function manualDataRecovery(barcode, sourceType) {
  const currentOrder = getCurrentOrder();
  if (!currentOrder) return { success: false, message: '활성 발주서 없음' };
  
  const ss = SpreadsheetApp.openById(currentOrder.orderId);
  
  try {
    if (sourceType === 'SHIPPING_HISTORY') {
      // 출고이력 기준으로 복구
      const historySheet = ss.getSheetByName('출고이력');
      const truthData = collectTruthDataForBarcode(historySheet, barcode);
      
      if (truthData) {
        updateOrderSheetFromTruth(ss.getSheetByName('발주서'), barcode, truthData);
        return { success: true, message: '출고이력 기준으로 복구 완료' };
      }
    } else if (sourceType === 'PACKING_LIST') {
      // 패킹리스트 기준으로 복구
      const packingSheet = ss.getSheetByName('패킹리스트');
      const packingData = collectPackingDataForBarcode(packingSheet, barcode);
      
      if (packingData) {
        updateOrderSheetFromPacking(ss.getSheetByName('발주서'), barcode, packingData);
        return { success: true, message: '패킹리스트 기준으로 복구 완료' };
      }
    }
    
    return { success: false, message: '복구할 데이터를 찾을 수 없습니다' };
    
  } catch (error) {
    console.error('수동 복구 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 특정 바코드의 Truth 데이터 수집
function collectTruthDataForBarcode(historySheet, targetBarcode) {
  if (!historySheet || historySheet.getLastRow() <= 1) return null;
  
  const data = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, 8).getValues();
  const boxData = {};
  
  data.forEach(row => {
    const [timestamp, boxNumber, barcode, name, option, quantity] = row;
    
    if (barcode === targetBarcode) {
      const box = String(boxNumber).replace(/[^0-9]/g, '');
      const qty = parseInt(quantity) || 0;
      
      if (!boxData[box]) boxData[box] = 0;
      boxData[box] += qty;
    }
  });
  
  return Object.keys(boxData).length > 0 ? boxData : null;
}

// Truth 데이터로 발주서 업데이트
function updateOrderSheetFromTruth(orderSheet, barcode, boxData) {
  const lastRow = orderSheet.getLastRow();
  if (lastRow <= 6) return;
  
  const data = orderSheet.getRange(7, 1, lastRow - 6, 1).getValues();
  
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === barcode) {
      const rowIndex = 7 + i;
      const newBoxNumbers = formatBoxNumbers(boxData);
      orderSheet.getRange(rowIndex, 16).setValue(newBoxNumbers);
      
      // 로그 기록
      console.log(`복구 완료: ${barcode} - ${newBoxNumbers}`);
      break;
    }
  }
}

// 패킹리스트에서 특정 바코드 데이터 수집
function collectPackingDataForBarcode(packingSheet, targetBarcode) {
  if (!packingSheet || packingSheet.getLastRow() <= 1) return null;
  
  const data = packingSheet.getDataRange().getValues();
  const boxData = {};
  
  // 패킹리스트 구조: 박스번호가 A열, 상품 정보가 각 행에
  for (let i = 1; i < data.length; i++) {
    const boxNumber = String(data[i][0]).replace(/[^0-9]/g, '');
    if (!boxNumber) continue;
    
    // 각 열의 바코드와 수량 확인
    for (let j = 1; j < data[i].length; j += 2) {
      const barcode = String(data[i][j] || '');
      const quantity = parseInt(data[i][j + 1]) || 0;
      
      if (barcode === targetBarcode && quantity > 0) {
        if (!boxData[boxNumber]) boxData[boxNumber] = 0;
        boxData[boxNumber] += quantity;
      }
    }
  }
  
  return Object.keys(boxData).length > 0 ? boxData : null;
}

// 패킹리스트 데이터로 발주서 업데이트
function updateOrderSheetFromPacking(orderSheet, barcode, boxData) {
  updateOrderSheetFromTruth(orderSheet, barcode, boxData);
}
