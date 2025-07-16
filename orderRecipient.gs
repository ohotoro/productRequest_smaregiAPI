// ===== 발주처 관리 함수 =====

// 현재 발주서 정보 가져오기
function getCurrentOrder() {
  try {
    const userProperties = PropertiesService.getUserProperties();
    const currentOrder = userProperties.getProperty('currentOrder');
    
    return currentOrder ? JSON.parse(currentOrder) : null;
  } catch (error) {
    console.error('현재 발주서 정보 조회 실패:', error);
    return null;
  }
}

// 발주처 목록 가져오기 (캐시 적용)
function getOrderRecipientsList() {
  try {
    // 캐시 확인
    const cached = getCache('recipientsList');
    if (cached) return cached;
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    
    // 발주처 시트가 없으면 생성
    let recipientSheet = ss.getSheetByName('발주처');
    if (!recipientSheet) {
      recipientSheet = createRecipientSheet(ss);
    }
    
    const data = recipientSheet.getDataRange().getValues();
    const recipients = [];
    
    // 헤더 제외하고 데이터 수집
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        recipients.push(data[i][0]); // 발주처명만 수집
      }
    }
    
    // 캐시 저장 (1시간)
    setCache('recipientsList', recipients, CACHE_DURATION.MEDIUM);
    
    return recipients;
  } catch (error) {
    console.error('발주처 목록 조회 실패:', error);
    return [];
  }
}

// 발주처 시트 생성
function createRecipientSheet(spreadsheet) {
  const sheet = spreadsheet.insertSheet('발주처');
  
  const headers = [
    '발주처명', '발주처코드', '담당자', '연락처', '이메일', '주소', '메모'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#f0f0f0');
  
  // 컬럼 너비 조정
  const widths = [150, 100, 100, 120, 200, 250, 200];
  widths.forEach((width, index) => {
    sheet.setColumnWidth(index + 1, width);
  });
  
  return sheet;
}

// 발주처 상세 정보 가져오기 (캐시 적용)
function getOrderRecipientDetails(recipientName) {
  try {
    // 캐시 확인
    const cacheKey = `recipient_${recipientName}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName('발주처');
    
    if (!sheet) return null;
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === recipientName) {
        const details = {
          name: data[i][0],
          code: data[i][1] || '',
          contact: data[i][2] || '',
          phone: data[i][3] || '',
          email: data[i][4] || '',
          address: data[i][5] || '',
          memo: data[i][6] || ''
        };
        
        // 캐시 저장 (30분)
        setCache(cacheKey, details, CACHE_DURATION.SHORT);
        
        return details;
      }
    }
    
    return null;
  } catch (error) {
    console.error('발주처 정보 조회 실패:', error);
    return null;
  }
}

// 새 발주처 추가
function addNewOrderRecipient(recipientName) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let sheet = ss.getSheetByName('발주처');
    
    if (!sheet) {
      sheet = createRecipientSheet(ss);
    }
    
    // 중복 확인
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === recipientName) {
        return { success: false, message: '이미 존재하는 발주처입니다.' };
      }
    }
    
    // 새 발주처 추가
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1).setValue(recipientName);
    
    // 캐시 무효화
    invalidateCache('recipientsList');
    
    return { success: true, message: '새 발주처가 추가되었습니다.' };
  } catch (error) {
    console.error('발주처 추가 실패:', error);
    return { success: false, message: '발주처 추가에 실패했습니다.' };
  }
}

// 발주서 생성 (최적화)
function createNewOrder(recipientName) {
  try {
    if (!recipientName) {
      return { success: false, message: '발주처를 선택해주세요.' };
    }
    
    // 발주처 정보 확인
    let recipientDetails = getOrderRecipientDetails(recipientName);
    
    if (!recipientDetails) {
      const addResult = addNewOrderRecipient(recipientName);
      if (!addResult.success) {
        return addResult;
      }
      recipientDetails = { name: recipientName };
    }
    
    const now = new Date();
    const year = now.getFullYear();
    const dateStr = Utilities.formatDate(now, 'GMT+9', 'yyMMdd');
    
    // 폴더 구조 생성/확인
    const folders = getOrCreateFolders(year, recipientName);
    
    // 파일명 생성 (중복 확인 포함)
    const { fileName, fileNumber } = generateUniqueFileName(folders.recipientFolder, dateStr, recipientName);
    
    // 새 발주서 생성
    const newOrder = createOrderSpreadsheet(fileName, recipientName, recipientDetails, fileNumber, now);
    
    // 파일 이동
    moveFileToFolder(newOrder.getId(), folders.recipientFolder);
    
    // 발주서 정보 저장
    const orderInfo = {
      orderId: newOrder.getId(),
      orderUrl: newOrder.getUrl(),
      recipientName: recipientName,
      recipientDetails: recipientDetails,
      createdAt: now.toISOString(),
      fileName: fileName,
      orderNumber: fileNumber
    };
    
    const userProperties = PropertiesService.getUserProperties();
    userProperties.setProperty('currentOrder', JSON.stringify(orderInfo));
    
    return {
      success: true,
      message: fileNumber > 1 ? 
        `${fileNumber}차 발주서가 생성되었습니다.` : 
        '발주서가 생성되었습니다.',
      orderInfo: orderInfo
    };
    
  } catch (error) {
    console.error('발주서 생성 실패:', error);
    return {
      success: false,
      message: '발주서 생성에 실패했습니다: ' + error.toString()
    };
  }
}

// 폴더 구조 생성/확인 헬퍼
function getOrCreateFolders(year, recipientName) {
  const orderFolder = DriveApp.getFileById(CONFIG.ORDER_SHEET_ID).getParents().next();
  
  // 연도 폴더
  let yearFolder;
  const yearFolders = orderFolder.getFoldersByName(year.toString());
  if (yearFolders.hasNext()) {
    yearFolder = yearFolders.next();
  } else {
    yearFolder = orderFolder.createFolder(year.toString());
  }
  
  // 발주처 폴더
  let recipientFolder;
  const recipientFolders = yearFolder.getFoldersByName(recipientName);
  if (recipientFolders.hasNext()) {
    recipientFolder = recipientFolders.next();
  } else {
    recipientFolder = yearFolder.createFolder(recipientName);
  }
  
  return { orderFolder, yearFolder, recipientFolder };
}

// 유니크한 파일명 생성 헬퍼
function generateUniqueFileName(folder, dateStr, recipientName) {
  const baseFileName = `${dateStr}-${recipientName}`;
  let fileName = baseFileName;
  let fileNumber = 1;
  
  // 기존 파일 확인
  const existingFiles = folder.searchFiles(`title contains '${baseFileName}'`);
  const existingNumbers = [];
  
  while (existingFiles.hasNext()) {
    const file = existingFiles.next();
    const name = file.getName();
    const match = name.match(new RegExp(`${baseFileName}-(\\d+)`));
    if (match) {
      existingNumbers.push(parseInt(match[1]));
    } else if (name === baseFileName) {
      existingNumbers.push(1);
    }
  }
  
  if (existingNumbers.length > 0) {
    fileNumber = Math.max(...existingNumbers) + 1;
    fileName = `${baseFileName}-${fileNumber}`;
  }
  
  return { fileName, fileNumber };
}

// 발주서 스프레드시트 생성 헬퍼
function createOrderSpreadsheet(fileName, recipientName, recipientDetails, fileNumber, date) {
  const newOrder = SpreadsheetApp.create(fileName);
  const sheet = newOrder.getActiveSheet();
  sheet.setName('발주서');
  
  // 헤더 설정
  setupOrderHeader(sheet, recipientName, recipientDetails, fileNumber, date);
  
  // 상품 목록 헤더 (19개 열 모두 포함)
  const headers = [
    '바코드',        // A열
    '상품명',        // B열
    '옵션',          // C열
    '발주수량',      // D열
    '단가',          // E열
    '금액',          // F열
    '중량',          // G열
    '우선순위',      // H열
    '코멘트',        // I열
    '상태',          // J열
    '확정시간',      // K열
    '재고가능여부',  // L열
    '공급사',        // M열
    '내보내기시간',    // N열
    'CSV확인',       // O열
    '박스번호',      // P열
    '출고가능수량',  // Q열
    '출고상태',      // R열
    '출고완료시간'   // S열
  ];
  sheet.getRange(6, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#f0f0f0');
  
  // 컬럼 너비 설정 (19개 열)
  const widths = [
    120,  // A: 바코드
    200,  // B: 상품명
    150,  // C: 옵션
    80,   // D: 발주수량
    100,  // E: 단가
    120,  // F: 금액
    80,   // G: 중량
    80,   // H: 우선순위
    200,  // I: 코멘트
    80,   // J: 상태
    120,  // K: 확정시간
    120,  // L: 재고가능여부
    150,  // M: 공급사
    120,  // N: 내보내기시간
    60,   // O: CSV확인
    150,  // P: 박스번호
    100,  // Q: 출고가능수량
    100,  // R: 출고상태
    120   // S: 출고완료시간
  ];
  widths.forEach((width, index) => {
    sheet.setColumnWidth(index + 1, width);
  });
  
  return newOrder;
}

// 발주서 헤더 설정 헬퍼
function setupOrderHeader(sheet, recipientName, recipientDetails, fileNumber, date) {
  sheet.getRange(1, 1).setValue('발주서').setFontSize(16).setFontWeight('bold');
  sheet.getRange(2, 1).setValue('발주처:').setFontWeight('bold');
  sheet.getRange(2, 2).setValue(recipientName);
  sheet.getRange(3, 1).setValue('발주일:').setFontWeight('bold');
  sheet.getRange(3, 2).setValue(Utilities.formatDate(date, 'GMT+9', 'yyyy-MM-dd'));
  sheet.getRange(4, 1).setValue('담당자:').setFontWeight('bold');
  sheet.getRange(4, 2).setValue(Session.getActiveUser().getEmail());
  
  if (fileNumber > 1) {
    sheet.getRange(3, 5).setValue('차수:').setFontWeight('bold');
    sheet.getRange(3, 6).setValue(`${fileNumber}차`);
  }
  
  if (recipientDetails.contact) {
    sheet.getRange(2, 3).setValue('발주처 담당자:').setFontWeight('bold');
    sheet.getRange(2, 4).setValue(recipientDetails.contact);
  }
  if (recipientDetails.phone) {
    sheet.getRange(3, 3).setValue('연락처:').setFontWeight('bold');
    sheet.getRange(3, 4).setValue(recipientDetails.phone);
  }
  if (recipientDetails.email) {
    sheet.getRange(4, 3).setValue('이메일:').setFontWeight('bold');
    sheet.getRange(4, 4).setValue(recipientDetails.email);
  }
}

// 파일 이동 헬퍼
function moveFileToFolder(fileId, targetFolder) {
  const file = DriveApp.getFileById(fileId);
  targetFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
}

// 오늘 발주 현황 (캐시 적용)
function getTodayOrderStatus() {
  try {
    // 캐시 확인
    const cacheKey = 'todayOrderStatus';
    const cached = getCache(cacheKey);
    if (cached) return cached;
    
    const today = Utilities.formatDate(new Date(), 'GMT+9', 'yyMMdd');
    const rootFolder = DriveApp.getFileById(CONFIG.ORDER_SHEET_ID).getParents().next();
    const currentYear = new Date().getFullYear();
    
    const orderStatus = {};
    
    const yearFolders = rootFolder.getFoldersByName(currentYear.toString());
    if (yearFolders.hasNext()) {
      const yearFolder = yearFolders.next();
      
      const recipientFolders = yearFolder.getFolders();
      while (recipientFolders.hasNext()) {
        const folder = recipientFolders.next();
        const recipientName = folder.getName();
        
        const todayFiles = folder.searchFiles(`title contains '${today}-${recipientName}'`);
        let count = 0;
        
        while (todayFiles.hasNext()) {
          todayFiles.next();
          count++;
        }
        
        if (count > 0) {
          orderStatus[recipientName] = count;
        }
      }
    }
    
    // 캐시 저장 (5분)
    setCache(cacheKey, orderStatus, CACHE_DURATION.SHORT);
    
    return orderStatus;
  } catch (error) {
    console.error('오늘 발주 현황 조회 실패:', error);
    return {};
  }
}

// 최근 발주서 목록 (최적화)
function getRecentOrders() {
  try {
    // 캐시 확인
    const cacheKey = 'recentOrders';
    const cached = getCache(cacheKey);
    if (cached) return cached;
    
    const recentOrders = [];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const orderFolder = DriveApp.getFileById(CONFIG.ORDER_SHEET_ID).getParents().next();
    const currentYear = new Date().getFullYear();
    
    const yearFolders = orderFolder.getFoldersByName(currentYear.toString());
    if (!yearFolders.hasNext()) {
      return [];
    }
    
    const yearFolder = yearFolders.next();
    const recipientFolders = yearFolder.getFolders();
    
    while (recipientFolders.hasNext()) {
      const recipientFolder = recipientFolders.next();
      const recipientName = recipientFolder.getName();
      
      const files = recipientFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
      
      while (files.hasNext()) {
        try {
          const file = files.next();
          const createdDate = file.getDateCreated();
          
          if (createdDate >= thirtyDaysAgo) {
            const fileName = file.getName();
            const match = fileName.match(/(\d{6})-(.+?)(?:-(\d+))?$/);
            const orderNumber = match && match[3] ? match[3] : '1';
            
            recentOrders.push({
              id: file.getId(),
              name: fileName,
              supplier: recipientName,
              createdAt: createdDate.toISOString(),
              url: file.getUrl(),
              orderNumber: orderNumber
            });
          }
        } catch (fileError) {
          continue;
        }
      }
    }
    
    // 날짜순 정렬 (최신순)
    recentOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const result = recentOrders.slice(0, 50);
    
    // 캐시 저장 (10분)
    setCache(cacheKey, result, 600);
    
    return result;
    
  } catch (error) {
    console.error('최근 발주서 조회 실패:', error);
    return [];
  }
}

// 발주서 저장 (최적화)
function saveToOrderSheet(items) {
  try {
    const currentOrder = getCurrentOrder();
    if (!currentOrder) {
      return { success: false, message: '생성된 발주서가 없습니다.' };
    }
    
    const ss = SpreadsheetApp.openById(currentOrder.orderId);
    const sheet = ss.getSheetByName('발주서');
    
    // 기존 데이터 백업 (P, Q, R, S 열 보존)
    const lastRow = sheet.getLastRow();
    let existingData = [];
    if (lastRow > 6) {
      const lastCol = sheet.getLastColumn();
      const numCols = Math.max(19, lastCol);
      existingData = sheet.getRange(7, 1, lastRow - 6, numCols).getValues();
      
      // 바코드별로 기존 데이터 맵 생성 (N~S열 보존)
      const existingDataMap = new Map();
      existingData.forEach((row, index) => {
        const barcode = String(row[0]);
        if (!existingDataMap.has(barcode)) {
          existingDataMap.set(barcode, []);
        }
        existingDataMap.get(barcode).push({
          index: index,
          nColumn: row[13] || '', // N열: 내보내기 시간
          oColumn: row[14] || '', // O열: CSV확인
          pColumn: row[15] || '', // P열: 박스번호
          qColumn: row[16] || '', // Q열: 출고가능수량
          rColumn: row[17] || '', // R열: 출고상태
          sColumn: row[18] || ''  // S열: 출고완료시간
        });
      });
      
      sheet.deleteRows(7, lastRow - 6);
    }
    
    // 새 데이터 추가
    if (items.length > 0) {
      const data = items.map(item => {
        let stockAvailable = item.stockAvailable || '미확인';
        
        // 숫자만 있는 경우 "X개만 가능" 형식으로 변환
        if (!isNaN(stockAvailable) && stockAvailable !== '' && stockAvailable !== '미확인') {
          stockAvailable = `${stockAvailable}개만 가능`;
        }
        
        // 기존 N~S열 데이터 찾기
        let nCol = '', oCol = '', pCol = '', qCol = '', rCol = '', sCol = '';
        if (existingDataMap && existingDataMap.has(item.barcode)) {
          const matches = existingDataMap.get(item.barcode);
          if (matches.length > 0) {
            // 첫 번째 매칭 데이터 사용 (중복 바코드의 경우)
            nCol = matches[0].nColumn;
            oCol = matches[0].oColumn;
            pCol = matches[0].pColumn;
            qCol = matches[0].qColumn;
            rCol = matches[0].rColumn;
            sCol = matches[0].sColumn;
          }
        }
        
        return [
          item.barcode,            // A열
          item.name,                // B열
          item.option,              // C열
          item.quantity,            // D열
          item.purchasePrice || 0,  // E열
          item.quantity * (item.purchasePrice || 0), // F열
          item.weight || '',        // G열
          item.priority || 3,       // H열
          item.comment || '',       // I열
          item.status || '대기',    // J열
          item.confirmedAt || '',   // K열
          stockAvailable,           // L열
          item.supplierName || '',  // M열
          nCol,                     // N열: 내보내기 시간 (보존)
          oCol,                     // O열: CSV확인 (보존)
          pCol,                     // P열: 박스번호 (보존)
          qCol,                     // Q열: 출고가능수량 (보존)
          rCol,                     // R열: 출고상태 (보존)
          sCol                      // S열: 출고완료시간 (보존)
        ];
      });
      
      sheet.getRange(7, 1, data.length, data[0].length).setValues(data);
      sheet.getRange(7, 12, data.length, 1).setNumberFormat('@'); // L열 텍스트 형식
      
      // 합계 추가
      const totalRow = 7 + items.length;
      sheet.getRange(totalRow, 5).setValue('합계:').setFontWeight('bold');
      sheet.getRange(totalRow, 6).setFormula(`=SUM(F7:F${totalRow-1})`).setFontWeight('bold');
    }
    
    // 마지막 저장 시간 기록
    updateOrderMetadata(sheet, 'save');
    
    // 공유 최근 상품 업데이트 (배치 처리)
    const products = items.map(item => ({
      barcode: item.barcode,
      name: item.name,
      option: item.option,
      supplierName: item.supplierName,
      purchasePrice: item.purchasePrice,
      weight: item.weight,
      searchText: `${item.barcode} ${item.name} ${item.option}`.toLowerCase()
    }));
    
    batchUpdateSharedRecentProducts(products);
    
    return {
      success: true,
      message: '발주서가 저장되었습니다.',
      savedCount: items.length
    };
    
  } catch (error) {
    console.error('발주서 저장 실패:', error);
    return {
      success: false,
      message: '저장에 실패했습니다: ' + error.toString()
    };
  }
}

// 발주서 열기 (최적화)
function openOrder(orderId) {
  try {
    if (!orderId) {
      return { 
        success: false, 
        message: '발주서 ID가 제공되지 않았습니다.' 
      };
    }
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { 
        success: false, 
        message: '발주서 시트를 찾을 수 없습니다.' 
      };
    }
    
    // 발주서 정보 추출
    const orderInfo = extractOrderInfo(sheet, ss, orderId);
    
    // 발주 항목 로드 - 함수명 변경
    const items = loadOrderItemsHelper(sheet);
    
    // 현재 발주서 정보 저장
    const userProperties = PropertiesService.getUserProperties();
    userProperties.setProperty('currentOrder', JSON.stringify(orderInfo));
    
    return {
      success: true,
      orderInfo: orderInfo,
      items: items
    };
    
  } catch (error) {
    console.error('발주서 열기 실패:', error);
    return {
      success: false,
      message: '발주서를 열 수 없습니다: ' + error.toString()
    };
  }
}

// 발주서 정보 추출 헬퍼
function extractOrderInfo(sheet, spreadsheet, orderId) {
  let recipientName = '알 수 없음';
  let orderDate = new Date();
  let orderNumber = '1';
  
  try {
    recipientName = sheet.getRange(2, 2).getValue() || '알 수 없음';
    orderDate = sheet.getRange(3, 2).getValue() || new Date();
    const orderNumberValue = sheet.getRange(3, 6).getValue();
    
    if (orderNumberValue) {
      const match = String(orderNumberValue).match(/(\d+)/);
      orderNumber = match ? match[1] : '1';
    }
  } catch (error) {
    console.error('발주서 정보 추출 실패:', error);
  }
  
  return {
    orderId: orderId,
    orderUrl: spreadsheet.getUrl(),
    recipientName: recipientName,
    fileName: spreadsheet.getName(),
    orderNumber: orderNumber,
    createdAt: orderDate instanceof Date ? orderDate.toISOString() : new Date().toISOString()
  };
}

// 발주 항목 로드 헬퍼
function loadOrderItemsHelper(sheet) {
  const lastRow = sheet.getLastRow();
  const items = [];
  
  if (lastRow > 6) {
    try {
      const data = sheet.getRange(7, 1, lastRow - 6, 13).getValues();
      
      data.forEach((row, index) => {
        if (row[0]) {
          items.push({
            barcode: String(row[0] || ''),
            name: String(row[1] || ''),
            option: String(row[2] || ''),
            quantity: Number(row[3]) || 1,
            purchasePrice: Number(row[4]) || 0,
            weight: String(row[6] || ''),
            priority: Number(row[7]) || 3,
            comment: String(row[8] || ''),
            status: String(row[9] || '대기'),
            confirmedAt: String(row[10] || ''),
            stockAvailable: String(row[11] || '미확인'),
            supplierName: String(row[12] || ''),
            id: Date.now() + index
          });
        }
      });
    } catch (error) {
      console.error('발주 항목 로드 실패:', error);
    }
  }
  
  return items;
}

// 배치 공유 최근 상품 업데이트
function batchUpdateSharedRecentProducts(products) {
  try {
    const cache = CacheService.getScriptCache();
    const scriptProps = PropertiesService.getScriptProperties();
    
    let recentProducts = cache.get('SHARED_RECENT_PRODUCTS');
    if (!recentProducts) {
      recentProducts = scriptProps.getProperty('SHARED_RECENT_PRODUCTS');
    }
    
    recentProducts = recentProducts ? JSON.parse(recentProducts) : [];
    
    // 기존 바코드 세트 생성
    const existingBarcodes = new Set(recentProducts.map(p => p.barcode));
    
    // 새 상품 추가
    const userEmail = Session.getActiveUser().getEmail();
    const now = new Date().toISOString();
    
    products.forEach(product => {
      if (!existingBarcodes.has(product.barcode)) {
        recentProducts.unshift({
          ...product,
          lastUsedBy: userEmail,
          lastUsedAt: now
        });
      }
    });
    
    // 30일 이내 항목만 유지 (최대 500개)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    recentProducts = recentProducts
      .filter(p => new Date(p.lastUsedAt) > thirtyDaysAgo)
      .slice(0, 500);
    
    const dataStr = JSON.stringify(recentProducts);
    cache.put('SHARED_RECENT_PRODUCTS', dataStr, 3600);
    scriptProps.setProperty('SHARED_RECENT_PRODUCTS', dataStr);
    
  } catch (error) {
    console.error('배치 공유 상품 업데이트 실패:', error);
  }
}
