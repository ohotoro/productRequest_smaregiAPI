// ===== 전역 설정 Code.gs ===== 


// ===== 웹앱 진입점 =====
function doGet() {
  const template = HtmlService.createTemplateFromFile('index');
  
  // 사용자 언어 설정 가져오기
  const userProperties = PropertiesService.getUserProperties();
  const userLang = userProperties.getProperty('language') || 'ko';
  
  return template
    .evaluate()
    .setTitle('OHOTORO 발주관리 / OHOTORO発注管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Code.gs - 상품 데이터 압축
function compressProductData(products) {
  return products.map(p => ({
    b: p.barcode,
    n: p.name,
    o: p.option,
    p: p.purchasePrice,
    s: p.supplierName,
    w: p.weight,
    f: p.isFrequent,
    r: p.isRecent
  }));
}

// ===== HTML 파일 인클루드 =====
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ===== 초기 데이터 로드 (캐시 크기 문제 해결) =====
function loadInitialProductsWithIssues() {
  try {
    console.log('=== 초기 데이터 로드 시작 ===');
    const startTime = new Date();
    
    // 기본 반환 구조
    const defaultReturn = {
      products: [],
      productIssues: {},
      cached: false,
      loadTime: 0
    };
    
    // 스프레드시트 ID 확인
    if (!CONFIG.PRODUCT_SHEET_ID) {
      console.error('상품 시트 ID가 설정되지 않았습니다.');
      return defaultReturn;
    }
    
    // 캐시 확인
    try {
      const cached = getCache(CACHE_KEYS.INITIAL_PRODUCTS);
      if (cached && cached.products && Array.isArray(cached.products)) {
        console.log(`캐시에서 ${cached.products.length}개 상품 반환`);
        return {
          products: cached.products,
          productIssues: cached.productIssues || {},
          cached: true,
          loadTime: new Date() - startTime
        };
      }
    } catch (cacheError) {
      console.warn('캐시 조회 실패:', cacheError);
    }
    
    // 타임아웃 설정 (30초)
    const timeoutTime = startTime.getTime() + 30000;
    
    // 1. 자주 발주 바코드
    let frequentBarcodes = [];
    try {
      frequentBarcodes = getCachedFrequentBarcodes() || [];
      console.log(`자주 발주 바코드 ${frequentBarcodes.length}개 로드`);
    } catch (e) {
      console.error('자주 발주 바코드 로드 실패:', e);
    }
    
    // 2. 최근 추가 상품
    let recentProducts = [];
    try {
      recentProducts = getRecentProducts(50) || [];
      console.log(`최근 추가 상품 ${recentProducts.length}개 로드`);
    } catch (e) {
      console.error('최근 추가 상품 로드 실패:', e);
    }
    
    // 3. 공유 최근 상품
    let sharedRecent = [];
    try {
      sharedRecent = getSharedRecentProducts().slice(0, 20) || [];
      console.log(`공유 최근 상품 ${sharedRecent.length}개 로드`);
    } catch (e) {
      console.error('공유 최근 상품 로드 실패:', e);
    }
    
    // 4. 제품 이슈사항
    let productIssues = {};
    try {
      productIssues = loadProductIssues() || {};
      console.log(`제품 이슈사항 ${Object.keys(productIssues).length}개 로드`);
    } catch (e) {
      console.error('제품 이슈사항 로드 실패:', e);
    }
    
    // 중복 제거 및 병합
    const productMap = new Map();
    
    // 공유 최근 상품 추가
    if (Array.isArray(sharedRecent)) {
      sharedRecent.forEach(p => {
        if (p && p.barcode) {
          p.isSharedRecent = true;
          p.priority = 1;
          productMap.set(p.barcode, p);
        }
      });
    }
    
    // 자주 발주 상품 정보 가져오기
    if (frequentBarcodes.length > 0) {
      try {
        const frequentProducts = getProductsByBarcodes(frequentBarcodes) || [];
        if (Array.isArray(frequentProducts)) {
          frequentProducts.forEach(p => {
            if (p && p.barcode) {
              if (!productMap.has(p.barcode)) {
                productMap.set(p.barcode, p);
              }
              const existing = productMap.get(p.barcode);
              existing.isFrequent = true;
              existing.priority = Math.min(existing.priority || 999, 2);
            }
          });
        }
      } catch (e) {
        console.error('자주 발주 상품 정보 로드 실패:', e);
      }
    }
    
    // 최근 추가 상품
    if (Array.isArray(recentProducts)) {
      recentProducts.forEach(p => {
        if (p && p.barcode) {
          if (!productMap.has(p.barcode)) {
            productMap.set(p.barcode, p);
          }
          const existing = productMap.get(p.barcode);
          existing.isRecent = p.isRecent;
        }
      });
    }
    
    // 이슈 정보 병합
    productMap.forEach((product, barcode) => {
      if (productIssues[barcode]) {
        product.issueMemo = productIssues[barcode].memo;
        product.issueRemarks = productIssues[barcode].remarks;
      }
    });
    
    const products = Array.from(productMap.values())
      .sort((a, b) => (a.priority || 999) - (b.priority || 999))
      .slice(0, 100); // 100개로 제한
    
    // 캐시 저장 시도
    try {
      const dataToCache = {
        products: products,
        productIssues: productIssues,
        timestamp: new Date().toISOString()
      };
      setCache(CACHE_KEYS.INITIAL_PRODUCTS, dataToCache, CACHE_DURATION.MEDIUM);
    } catch (e) {
      console.warn('캐시 저장 실패 (무시):', e);
    }
    
    const loadTime = new Date() - startTime;
    console.log(`데이터 로드 완료: ${products.length}개 상품 (${loadTime}ms)`);
    
    return {
      products: products,
      productIssues: productIssues,
      cached: false,
      loadTime: loadTime
    };
    
  } catch (error) {
    console.error('통합 데이터 로드 실패:', error);
    
    // 오류가 발생해도 기본 구조는 반환
    return {
      products: [],
      productIssues: {},
      error: error.toString(),
      cached: false,
      loadTime: 0
    };
  }
}

// ===== 초기 데이터 로드 (캐시 크기 문제 해결) =====
function loadInitialProducts() {
  try {
    // 스프레드시트 ID 확인
    if (!CONFIG.PRODUCT_SHEET_ID) {
      console.error('상품 시트 ID가 설정되지 않았습니다.');
      return [];
    }
    
    // 캐시 확인
    const cacheKey = CACHE_KEYS.INITIAL_PRODUCTS;
    const cachedData = getChunkedCache(cacheKey);
    
    if (cachedData && cachedData.timestamp) {
      const age = (new Date() - new Date(cachedData.timestamp)) / 1000 / 60;
      if (age < 30) {
        console.log('캐시에서 데이터 로드');
        return cachedData.products;
      }
    }
    
    // 병렬로 데이터 수집 (Promise.all 사용)
    const tasks = [
      getCachedFrequentBarcodes(),
      getRecentProducts(100),
      getSharedRecentProducts().slice(0, 50)
    ];
    
    const [frequentBarcodes, recentProducts, sharedRecent] = tasks.map(task => {
      try {
        return task;
      } catch (e) {
        console.error('Task failed:', e);
        return [];
      }
    });
    
    // 중복 제거하여 병합
    const productMap = new Map();
    
    // 1. 공유 최근 상품 (우선순위 높음)
    sharedRecent.forEach(p => {
      p.isSharedRecent = true;
      p.priority = 1;
      productMap.set(p.barcode, p);
    });
    
    // 2. 자주 발주 상품 (상위 100개만)
    const limitedFrequentBarcodes = frequentBarcodes.slice(0, 100);
    const frequentProducts = getProductsByBarcodes(limitedFrequentBarcodes);
    frequentProducts.forEach(p => {
      if (!productMap.has(p.barcode)) {
        productMap.set(p.barcode, p);
      }
      const existing = productMap.get(p.barcode);
      existing.isFrequent = true;
      existing.priority = Math.min(existing.priority || 999, 2);
    });
    
    // 3. 최근 추가 상품
    recentProducts.forEach(p => {
      if (!productMap.has(p.barcode)) {
        productMap.set(p.barcode, p);
      }
      const existing = productMap.get(p.barcode);
      existing.isRecent = p.isRecent;
    });
    
    // 배열로 변환하고 우선순위 정렬
    const products = Array.from(productMap.values())
      .sort((a, b) => (a.priority || 999) - (b.priority || 999))
      .slice(0, 200); // 최대 200개로 제한
    
    // 청크 방식으로 캐시 저장
    setChunkedCache(cacheKey, {
      products: products,
      timestamp: new Date().toISOString()
    }, CACHE_DURATION.MEDIUM);
    
    console.log('초기 로드 완료:', products.length + '개 상품');
    return products;
    
  } catch (error) {
    console.error('초기 상품 로드 실패:', error);
    return [];
  }
}

// ===== 청크 캐시 헬퍼 함수들 추가 =====
function setChunkedCache(key, data, duration = CACHE_DURATION.MEDIUM) {
  try {
    const cache = CacheService.getScriptCache();
    const jsonData = JSON.stringify(data);
    const chunkSize = 90000; // 90KB per chunk
    
    // 작은 데이터는 그냥 저장
    if (jsonData.length <= chunkSize) {
      cache.put(key, jsonData, duration);
      return true;
    }
    
    // 큰 데이터는 청크로 분할
    const chunks = [];
    for (let i = 0; i < jsonData.length; i += chunkSize) {
      chunks.push(jsonData.substring(i, i + chunkSize));
    }
    
    // 청크 정보 저장
    cache.put(key + '_info', JSON.stringify({
      chunks: chunks.length,
      size: jsonData.length
    }), duration);
    
    // 각 청크 저장
    chunks.forEach((chunk, index) => {
      cache.put(key + '_' + index, chunk, duration);
    });
    
    console.log(`청크 캐시 저장 완료: ${chunks.length}개 청크`);
    return true;
    
  } catch (error) {
    console.error('청크 캐시 저장 실패:', error);
    return false;
  }
}

function getChunkedCache(key) {
  try {
    const cache = CacheService.getScriptCache();
    
    // 청크 정보 확인
    const infoStr = cache.get(key + '_info');
    if (!infoStr) {
      // 일반 캐시 시도
      const directCache = cache.get(key);
      if (directCache) {
        return JSON.parse(directCache);
      }
      return null;
    }
    
    const info = JSON.parse(infoStr);
    let fullData = '';
    
    // 모든 청크 조합
    for (let i = 0; i < info.chunks; i++) {
      const chunk = cache.get(key + '_' + i);
      if (!chunk) {
        console.error('청크 누락:', i);
        return null;
      }
      fullData += chunk;
    }
    
    return JSON.parse(fullData);
    
  } catch (error) {
    console.error('청크 캐시 조회 실패:', error);
    return null;
  }
}

// getCurrentOrder 함수 수정
function getCurrentOrder() {
  try {
    const userProperties = PropertiesService.getUserProperties();
    const currentOrderJson = userProperties.getProperty('currentOrder');
    
    if (!currentOrderJson) {
      console.log('저장된 발주서 정보가 없습니다.');
      return null;
    }
    
    const currentOrder = JSON.parse(currentOrderJson);
    console.log('현재 발주서 정보:', currentOrder);
    
    // 발주서가 실제로 존재하는지 확인
    try {
      const ss = SpreadsheetApp.openById(currentOrder.orderId);
      const sheet = ss.getSheetByName('발주서');
      
      if (!sheet) {
        console.error('발주서 시트가 없습니다.');
        userProperties.deleteProperty('currentOrder');
        return null;
      }
      
      // 발주처 정보 업데이트 (B2 셀)
      try {
        currentOrder.recipientName = sheet.getRange(2, 2).getValue() || currentOrder.recipientName;
      } catch (e) {
        console.warn('발주처 정보 읽기 실패:', e);
      }
      
      // orderInfo 객체 반환
      return {
        orderId: currentOrder.orderId,
        fileName: currentOrder.fileName || ss.getName(),
        recipientName: currentOrder.recipientName,
        orderUrl: currentOrder.orderUrl || ss.getUrl(),
        createdAt: currentOrder.createdAt,
        orderNumber: currentOrder.orderNumber
      };
      
    } catch (e) {
      console.error('발주서 확인 실패:', e);
      // 잘못된 ID는 삭제
      userProperties.deleteProperty('currentOrder');
      return null;
    }
    
  } catch (error) {
    console.error('현재 발주서 확인 실패:', error);
    return null;
  }
}

// 박스 바코드인지 확인하는 서버 사이드 함수
function isValidBoxBarcode(barcode) {
  const settings = getSettings();
  
  if (settings.boxMode === 'barcode') {
    const boxBarcodes = settings.boxBarcodes || [];
    return boxBarcodes.some(box => box.barcode === barcode);
  } else {
    // 번호 모드에서는 숫자 패턴 확인
    const digits = parseInt(settings.boxDigits) || 3;
    const pattern = new RegExp(`^\\d{${digits}}$`);
    return pattern.test(barcode);
  }
}

// ===== 자주 발주하는 상품 바코드 목록 =====
function getFrequentProductBarcodes() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    
    const orderCount = {};
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    // 발주 이력 분석
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const dateStr = sheetName.substring(0, 6);
        const year = 2000 + parseInt(dateStr.substring(0, 2));
        const month = parseInt(dateStr.substring(2, 4)) - 1;
        const day = parseInt(dateStr.substring(4, 6));
        const sheetDate = new Date(year, month, day);
        
        if (sheetDate >= threeMonthsAgo) {
          const data = sheet.getDataRange().getValues();
          
          for (let i = 1; i < data.length; i++) {
            const barcode = String(data[i][0]);
            if (barcode) {
              orderCount[barcode] = (orderCount[barcode] || 0) + 1;
            }
          }
        }
      }
    });
    
    // 발주 횟수 순으로 정렬하여 상위 1000개 반환
    return Object.entries(orderCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1000)
      .map(([barcode]) => barcode);
      
  } catch (error) {
    console.error('자주 발주 바코드 조회 실패:', error);
    return [];
  }
}

// ===== 최근 추가된 상품 =====
function getRecentProducts(limit) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    
    const lastRow = sheet.getLastRow();
    const startRow = 2; // 헤더 제외
    const numRows = lastRow - startRow + 1;
    
    if (numRows <= 0) return [];
    
    // 전체 데이터 가져오기 (A~K열, 11개 컬럼)
    const data = sheet.getRange(startRow, 1, numRows, 11).getValues();
    const products = [];
    
    // 마지막 100개의 인덱스 계산
    const recentStartIndex = Math.max(0, data.length - 100);
    
    // 역순으로 처리 (최신 상품부터)
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i][0] && products.length < limit) {
        products.push({
          barcode: String(data[i][0]),  // A열
          name: data[i][1] || '',       // B열
          option: data[i][2] || '',     // C열
          weight: data[i][3] || '',     // D열
          supplierName: data[i][4] || '', // E열
          purchasePrice: parseFloat(data[i][8]) || 0, // I열
          memo: data[i][9] || '',       // J열
          remarks: data[i][10] || '',   // K열
          searchText: `${data[i][0]} ${data[i][1]} ${data[i][2]}`.toLowerCase(),
          isRecent: i >= recentStartIndex // 마지막 100개만 true
        });
      }
    }
    
    return products;
  } catch (error) {
    console.error('최근 상품 조회 실패:', error);
    return [];
  }
}

// ===== 바코드 목록으로 상품 정보 가져오기 =====
function getProductsByBarcodes(barcodes) {
  if (!barcodes || barcodes.length === 0) return [];
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    
    const data = sheet.getDataRange().getValues();
    const barcodeSet = new Set(barcodes);
    const products = [];
    
    for (let i = 1; i < data.length; i++) {
      const barcode = String(data[i][0]);
      if (barcodeSet.has(barcode)) {
        products.push({
          barcode: barcode,
          name: data[i][1] || '',
          option: data[i][2] || '',
          weight: data[i][3] || '',
          supplierName: data[i][4] || '',
          supplierAddress: data[i][5] || '',
          supplierPhone: data[i][6] || '',
          supplierProductName: data[i][7] || '',
          purchasePrice: parseFloat(data[i][8]) || 0,
          memo: data[i][9] || '',
          remarks: data[i][10] || '',
          searchText: `${data[i][0]} ${data[i][1]} ${data[i][2]}`.toLowerCase()
        });
      }
    }
    
    return products;
  } catch (error) {
    console.error('바코드 상품 조회 실패:', error);
    return [];
  }
}

// ===== 서버 사이드 검색 (전체 상품 대상) =====
function searchAllProducts(query, limit = 100) {
  console.log('searchAllProducts 호출, query:', query);
  
  if (!query || query.trim() === '') return [];
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    
    if (!sheet) {
      console.error('상품 시트를 찾을 수 없습니다');
      return [];
    }
    
    // 검색어를 소문자로 변환하고 공백 정규화
    const searchTerms = query.toLowerCase().trim().split(/\s+/);
    console.log('검색 단어들:', searchTerms);
    
    const data = sheet.getDataRange().getValues();
    const results = [];
    let totalChecked = 0;
    
    for (let i = 1; i < data.length && results.length < limit; i++) {
      if (data[i][0]) { // 바코드가 있는 경우만
        totalChecked++;
        
        // 검색 대상 필드들을 합쳐서 하나의 문자열로 만들기
        const searchableText = [
          data[i][0], // 바코드
          data[i][1], // 상품명
          data[i][2], // 옵션
          data[i][4], // 공급사명
          data[i][7]  // 공급사 상품명
        ].filter(Boolean).join(' ').toLowerCase();
        
        // 모든 검색어가 포함되어 있는지 확인
        const matchesAll = searchTerms.every(term => searchableText.includes(term));
        
        if (matchesAll) {
          results.push({
            barcode: String(data[i][0]),
            name: data[i][1] || '',
            option: data[i][2] || '',
            weight: data[i][3] || '',
            supplierName: data[i][4] || '',
            supplierAddress: data[i][5] || '',
            supplierPhone: data[i][6] || '',
            supplierProductName: data[i][7] || '',
            purchasePrice: parseFloat(data[i][8]) || 0,
            memo: data[i][9] || '',
            remarks: data[i][10] || '',
            searchText: searchableText,
            isServerResult: true,
            isRecent: false,
            isFrequent: false
          });
          
          console.log(`매치 발견: ${data[i][1]} - ${data[i][2]}`);
        }
      }
    }
    
    console.log(`전체 ${totalChecked}개 중 ${results.length}개 결과 찾음`);
    return results;
    
  } catch (error) {
    console.error('전체 검색 실패:', error);
    return [];
  }
}

// ===== 상품 상세 정보 가져오기 =====
function getProductDetails(barcode) {
  console.log('getProductDetails 호출:', barcode);
  
  try {
    // 입력 검증
    if (!barcode) {
      console.error('바코드가 없습니다');
      return null;
    }
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    
    if (!sheet) {
      console.error('상품 시트를 찾을 수 없습니다');
      return null;
    }
    
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    
    console.log(`${data.length - 1}개 상품 중에서 검색`);
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(barcode)) {
        console.log('상품 찾음:', data[i][1]);
        
        return {
          barcode: String(data[i][0]),
          name: String(data[i][1] || ''),
          option: String(data[i][2] || ''),
          weight: String(data[i][3] || ''),
          supplierName: String(data[i][4] || ''),
          supplierAddress: String(data[i][5] || ''),
          supplierPhone: String(data[i][6] || ''),
          supplierProductName: String(data[i][7] || ''),
          purchasePrice: Number(data[i][8]) || 0, // I열
          memo: String(data[i][9] || ''),
          remarks: String(data[i][10] || '')
        };
      }
    }
    
    console.log('상품을 찾을 수 없음:', barcode);
    return null;
    
  } catch (error) {
    console.error('상품 상세 조회 실패:', error);
    console.error('에러 상세:', error.toString());
    throw error; // 에러를 다시 throw하여 클라이언트에서 처리
  }
}

// ===== 카테고리 규칙 로드 =====
function loadCategoryRules() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('categoryRules');
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let sheet = ss.getSheetByName(CONFIG.CATEGORY_SHEET_NAME);
    
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.CATEGORY_SHEET_NAME);
      sheet.getRange(1, 1, 1, 2).setValues([['Keyword', 'Code']]);
    }
    
    const data = sheet.getDataRange().getValues();
    const rules = {};
    
    // 헤더 제외하고 규칙 생성
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][1]) {
        const keyword = data[i][0].toString().toLowerCase();
        const category = data[i][1].toString();
        rules[keyword] = category;
      }
    }
    
    cache.put('categoryRules', JSON.stringify(rules), CONFIG.CACHE_DURATION);
    return rules;
  } catch (error) {
    console.error('카테고리 규칙 로드 실패:', error);
    return {};
  }
}

// ===== 상품 검색 =====
function searchProducts(query) {
  if (!query || query.trim() === '') {
    return [];
  }
  
  const cachedProducts = getCache(CACHE_KEYS.INITIAL_PRODUCTS);
  const products = cachedProducts ? cachedProducts.products : [];
  
  const categoryRules = loadCategoryRules();
  const searchTerm = query.toLowerCase().trim();
  const results = [];
  
  // 검색 실행
  products.forEach(product => {
    const nameMatch = product.name.toLowerCase().includes(searchTerm);
    const barcodeMatch = product.barcode.toLowerCase().includes(searchTerm);
    const optionMatch = product.option.toLowerCase().includes(searchTerm);
    
    if (nameMatch || barcodeMatch || optionMatch) {
      // 카테고리 자동 분류
      let category = '기타';
      const productNameLower = product.name.toLowerCase();
      
      // 전체 일치 우선 확인
      if (categoryRules[productNameLower]) {
        category = categoryRules[productNameLower];
      } else {
        // 부분 일치 확인 (우선순위대로)
        for (const [keyword, cat] of Object.entries(categoryRules)) {
          if (productNameLower.includes(keyword)) {
            category = cat;
            break;
          }
        }
      }
      
      results.push({
        ...product,
        category: category
      });
    }
  });
  
  // 결과 제한
  return results.slice(0, CONFIG.MAX_SEARCH_RESULTS);
}

// ===== 자주 발주하는 상품 조회 =====
function getFrequentItems() {
  // cacheManager 사용
  const cached = getCache(CACHE_KEYS.FREQUENT_ITEMS);
  
  if (cached) {
    return cached;
  }
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    
    // 상품별 발주 데이터 수집
    const productOrders = {};
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      // 발주서 시트인지 확인 (YYMMDD 형식)
      if (/^\d{6}/.test(sheetName)) {
        const dateStr = sheetName.substring(0, 6);
        const sheetDate = parseSheetDate(dateStr);
        
        // 3개월 이내 데이터만 분석
        if (sheetDate >= threeMonthsAgo) {
          const data = sheet.getDataRange().getValues();
          
          for (let i = 1; i < data.length; i++) {
            if (data[i][0] && data[i][1]) { // 바코드와 상품명이 있는 경우
              const barcode = String(data[i][0]);
              const productName = data[i][1];
              const quantity = Number(data[i][3]) || 0;
              const option = data[i][2] || '';
              const supplierName = data[i][12] || '';
              
              // 상품 키 생성 (바코드 기준)
              if (!productOrders[barcode]) {
                productOrders[barcode] = {
                  barcode: barcode,
                  productName: productName,
                  option: option,
                  supplierName: supplierName,
                  orderCount: 0,
                  totalQuantity: 0,
                  lastOrderDate: null,
                  orderDates: []
                };
              }
              
              // 발주 정보 업데이트
              productOrders[barcode].orderCount += 1;
              productOrders[barcode].totalQuantity += quantity;
              productOrders[barcode].orderDates.push(sheetDate);
              
              // 마지막 발주일 업데이트
              if (!productOrders[barcode].lastOrderDate || sheetDate > productOrders[barcode].lastOrderDate) {
                productOrders[barcode].lastOrderDate = sheetDate;
              }
            }
          }
        }
      }
    });
    
    // 발주 횟수 기준으로 정렬하고 상위 항목 선택
    const frequentItems = Object.values(productOrders)
      .filter(item => item.orderCount >= 3) // 3회 이상 발주한 상품
      .sort((a, b) => {
        // 1차: 발주 횟수
        if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
        // 2차: 총 발주량
        return b.totalQuantity - a.totalQuantity;
      })
      .slice(0, 50) // 상위 50개
      .map(item => ({
        barcode: item.barcode,
        productName: item.productName,
        option: item.option,
        supplierName: item.supplierName,
        orderCount: item.orderCount,
        avgQuantity: Math.round(item.totalQuantity / item.orderCount),
        totalQuantity: item.totalQuantity,
        lastOrder: item.lastOrderDate ? Utilities.formatDate(item.lastOrderDate, 'GMT+9', 'yyyy-MM-dd') : '',
        // 평균 발주 주기 계산
        avgCycle: calculateAverageOrderCycle(item.orderDates)
      }));
    
    // 캐시에 저장 (1시간)
    setCache(CACHE_KEYS.FREQUENT_ITEMS, frequentItems, CACHE_DURATION.MEDIUM);
    
    return frequentItems;
    
  } catch (error) {
    console.error('자주 발주 상품 조회 실패:', error);
    return [];
  }
}

// ===== parseSheetDate 함수 추가 (누락된 헬퍼 함수) =====
function parseSheetDate(dateStr) {
  const year = 2000 + parseInt(dateStr.substring(0, 2));
  const month = parseInt(dateStr.substring(2, 4)) - 1;
  const day = parseInt(dateStr.substring(4, 6));
  return new Date(year, month, day);
}

// ===== 평균 발주 주기 계산 =====
function calculateAverageOrderCycle(orderDates) {
  if (orderDates.length < 2) return '-';
  
  // 날짜 정렬
  orderDates.sort((a, b) => a - b);
  
  let totalDays = 0;
  let intervals = 0;
  
  // 각 발주 간격 계산
  for (let i = 1; i < orderDates.length; i++) {
    const daysDiff = (orderDates[i] - orderDates[i-1]) / (1000 * 60 * 60 * 24);
    if (daysDiff > 0 && daysDiff < 90) { // 90일 이상 간격은 제외
      totalDays += daysDiff;
      intervals++;
    }
  }
  
  if (intervals === 0) return '-';
  
  const avgDays = Math.round(totalDays / intervals);
  return `${avgDays}일`;
}

// ===== 최근 7일간 발주된 바코드 조회 =====
function getRecentOrderedBarcodes(days) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    const recentBarcodes = new Set();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const dateStr = sheetName.substring(0, 6);
        const sheetDate = parseSheetDate(dateStr);
        
        if (sheetDate >= cutoffDate) {
          const data = sheet.getDataRange().getValues();
          
          for (let i = 1; i < data.length; i++) {
            const barcode = String(data[i][0]);
            if (barcode) {
              recentBarcodes.add(barcode);
            }
          }
        }
      }
    });
    
    return recentBarcodes;
    
  } catch (error) {
    console.error('최근 발주 바코드 조회 실패:', error);
    return new Set();
  }
}

// ===== 자주 발주 캐시 강제 갱신 =====
function refreshFrequentItemsCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('frequentItems');
  return getFrequentItems();
}

// ===== 특정 상품의 발주 이력 조회 =====
function getItemOrderHistory(barcode) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    const history = [];
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const data = sheet.getDataRange().getValues();
        
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][0]) === barcode) {
            const dateStr = sheetName.substring(0, 6);
            const sheetDate = parseSheetDate(dateStr);
            
            history.push({
              date: Utilities.formatDate(sheetDate, 'GMT+9', 'yyyy-MM-dd'),
              quantity: data[i][3] || 0,
              supplierName: data[i][12] || ''
            });
          }
        }
      }
    });
    
    // 날짜 기준 정렬 (최신순)
    history.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return history.slice(0, 20); // 최근 20개만
    
  } catch (error) {
    console.error('발주 이력 조회 실패:', error);
    return [];
  }
}

// ===== 발주서 저장 =====
function saveOrder(orderData) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheetName = Utilities.formatDate(new Date(), 'GMT+9', 'yyMMdd') + ' 발주서';
    
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      // 헤더 설정
      const headers = ['바코드', '상품명', '옵션', '발주수량', 'Memo', '중량', '우선순위', '코멘트', '상태', '확정시간'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    
    // 데이터 추가
    const lastRow = sheet.getLastRow();
    const newData = orderData.items.map(item => [
      item.barcode,
      item.name,
      item.option,
      item.quantity,
      item.memo || '',
      item.weight,
      item.priority || 3,
      item.comment || '',
      item.status || '대기',
      item.confirmedAt || ''
    ]);
    
    sheet.getRange(lastRow + 1, 1, newData.length, newData[0].length).setValues(newData);
    
    return { success: true, message: '발주서가 저장되었습니다.' };
  } catch (error) {
    console.error('발주서 저장 실패:', error);
    return { success: false, message: '발주서 저장에 실패했습니다.' };
  }
}

// ===== 발주 목록 로드 (Code.gs) =====
// Code.gs의 loadOrderItems 함수 수정
function loadOrderItems(orderId) {
  console.log('loadOrderItems 호출됨. orderId:', orderId);
  
  try {
    if (!orderId || typeof orderId !== 'string' || orderId.trim() === '') {
      return { success: false, message: '발주서 ID가 올바르지 않습니다.' };
    }
    
    let ss;
    try {
      ss = SpreadsheetApp.openById(orderId);
    } catch (e) {
      return { success: false, message: '발주서를 열 수 없습니다: ' + e.message };
    }
    
    const sheet = ss.getSheetByName('발주서');
    if (!sheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.' };
    }
    
    const items = [];
    const lastRow = sheet.getLastRow();
    
    if (lastRow > 6) {
      const numRows = Math.min(lastRow - 6, 1000);
      // P열(16열)까지 읽기
      const data = sheet.getRange(7, 1, numRows, 16).getValues();
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        
        if (!row[0] && !row[1] && !row[2]) break;
        
        if (row[0]) {
          // 내보내기 시간이 있으면 exportStatus 생성
          let exportStatus = '';
          if (row[13]) { // N열에 값이 있으면
            const exportTimeStr = String(row[13]);
            exportStatus = `내보내기 완료 (${exportTimeStr})`;
          }
          
          const item = {
            barcode: String(row[0] || ''),
            name: String(row[1] || ''),
            option: String(row[2] || ''),
            quantity: Number(row[3]) || 1,
            purchasePrice: Number(row[4]) || 0,
            weight: String(row[6] || ''),
            priority: Number(row[7]) || 3,
            comment: String(row[8] || ''),
            status: String(row[9] || '대기'),
            confirmedAt: row[10] ? String(row[10]) : '',
            stockAvailable: row[11] ? String(row[11]) : '미확인',
            supplierName: String(row[12] || ''),
            exportedAt: row[13] ? String(row[13]) : '', // N열: 내보내기 시간
            csvConfirmed: row[14] === '✓', // O열: CSV 확인 여부
            boxNumbers: row[15] ? String(row[15]) : '', // P열: 박스번호
            id: Date.now() + i + Math.random(),
            // exportStatus 추가
            exportStatus: exportStatus
          };
          
          items.push(item);
        }
      }
    }
    
    console.log('로드된 항목 수:', items.length);
    
    return { 
      success: true, 
      items: items,
      message: `${items.length}개 항목을 로드했습니다.`
    };
    
  } catch (error) {
    console.error('loadOrderItems 전체 오류:', error);
    return { 
      success: false, 
      message: '예상치 못한 오류: ' + error.message,
      error: error.toString()
    };
  }
}

// ===== 검색 인덱스 생성/업데이트 =====
function createSearchIndex() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let indexSheet = ss.getSheetByName('검색인덱스');
    
    if (!indexSheet) {
      indexSheet = ss.insertSheet('검색인덱스');
    } else {
      indexSheet.clear();
    }
    
    // 헤더 설정
    indexSheet.getRange(1, 1, 1, 4).setValues([['바코드', '검색텍스트', '자주발주', '최근추가']]);
    
    // 상품 데이터 가져오기
    const productSheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    const data = productSheet.getDataRange().getValues();
    
    // 자주 발주 바코드
    const frequentBarcodes = new Set(getCachedFrequentBarcodes());
    
    // 인덱스 데이터 생성
    const indexData = [];
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        const barcode = String(data[i][0]);
        const searchText = `${data[i][0]} ${data[i][1]} ${data[i][2]}`.toLowerCase();
        const isFrequent = frequentBarcodes.has(barcode) ? 'Y' : 'N';
        const isRecent = i > data.length - 500 ? 'Y' : 'N'; // 마지막 500개
        
        indexData.push([barcode, searchText, isFrequent, isRecent]);
      }
    }
    
    // 인덱스 저장
    if (indexData.length > 0) {
      indexSheet.getRange(2, 1, indexData.length, 4).setValues(indexData);
    }
    
    console.log(`${indexData.length}개 검색 인덱스 생성 완료`);
    return true;
    
  } catch (error) {
    console.error('검색 인덱스 생성 실패:', error);
    return false;
  }
}

// ===== 설정 조회 =====
function getSettings() {
  const userProperties = PropertiesService.getUserProperties();
  const settings = userProperties.getProperties();
  
  // 음성 설정 추가
  const voiceSettings = getVoiceSettings();
  
  // 박스 바코드는 스프레드시트에서 가져오기
  const boxBarcodes = getBoxBarcodesFromSheet();
  
  return {
    productSheetId: settings.productSheetId || CONFIG.PRODUCT_SHEET_ID,
    orderSheetId: settings.orderSheetId || CONFIG.ORDER_SHEET_ID,
    maxSearchResults: settings.maxSearchResults || CONFIG.MAX_SEARCH_RESULTS,
    language: settings.language || 'ko',
    monthlyBudget: settings.monthlyBudget || 10000000,
    suggestStock0: settings.suggestStock0 || '30',
    suggestStock10: settings.suggestStock10 || '20',
    suggestStock20: settings.suggestStock20 || '10',
    boxMode: settings.boxMode || 'barcode',
    boxDigits: settings.boxDigits || '3',
    boxBarcodes: boxBarcodes, // 스프레드시트에서 가져온 데이터
    maxLowStockDisplay: settings.maxLowStockDisplay || '50',
    // 음성 설정 추가
    voiceSettings: voiceSettings,
    // 판매 기간 설정 추가
    salesPeriodShort: settings.salesPeriodShort || '7',
    salesPeriodLong: settings.salesPeriodLong || '30',
    salesThresholdHot: settings.salesThresholdHot || '20',
    salesThresholdPopular: settings.salesThresholdPopular || '10',
    salesThresholdNormal: settings.salesThresholdNormal || '5'
  };
}

// ===== 임시 저장 데이터 로드 =====
function loadDraftOrder() {
  try {
    const userProperties = PropertiesService.getUserProperties();
    const draft = userProperties.getProperty('draftOrder');
    
    if (draft) {
      const draftData = JSON.parse(draft);
      // 7일 이내 데이터만 반환
      const savedDate = new Date(draftData.savedAt);
      const now = new Date();
      const daysDiff = (now - savedDate) / (1000 * 60 * 60 * 24);
      
      if (daysDiff <= 7) {
        return draftData.items;
      }
    }
    
    return [];
  } catch (error) {
    console.error('임시 저장 로드 실패:', error);
    return [];
  }
}

// ===== 임시 저장 =====
function saveDraftOrder(items) {
  try {
    const userProperties = PropertiesService.getUserProperties();
    const draftData = {
      items: items,
      savedAt: new Date().toISOString()
    };
    
    userProperties.setProperty('draftOrder', JSON.stringify(draftData));
    return { success: true, message: '임시 저장되었습니다.' };
  } catch (error) {
    console.error('임시 저장 실패:', error);
    return { success: false, message: '임시 저장에 실패했습니다.' };
  }
}

// ===== 임시 저장 삭제 =====
function clearDraftOrder() {
  try {
    const userProperties = PropertiesService.getUserProperties();
    userProperties.deleteProperty('draftOrder');
    return { success: true };
  } catch (error) {
    console.error('임시 저장 삭제 실패:', error);
    return { success: false };
  }
}

// ===== 설정 업데이트 ===== Code.gs에 추가
function updateSettings(newSettings) {
  try {
    const userProperties = PropertiesService.getUserProperties();
    
    // 기존 설정 처리
    if (newSettings.productSheetId) {
      userProperties.setProperty('productSheetId', newSettings.productSheetId);
    }
    if (newSettings.orderSheetId) {
      userProperties.setProperty('orderSheetId', newSettings.orderSheetId);
    }
    if (newSettings.maxSearchResults) {
      userProperties.setProperty('maxSearchResults', newSettings.maxSearchResults);
    }
    if (newSettings.language) {
      userProperties.setProperty('language', newSettings.language);
    }
    if (newSettings.monthlyBudget) {
      userProperties.setProperty('monthlyBudget', newSettings.monthlyBudget);
    }
    if (newSettings.suggestStock0) {
      userProperties.setProperty('suggestStock0', newSettings.suggestStock0);
    }
    if (newSettings.suggestStock10) {
      userProperties.setProperty('suggestStock10', newSettings.suggestStock10);
    }
    if (newSettings.suggestStock20) {
      userProperties.setProperty('suggestStock20', newSettings.suggestStock20);
    }
    if (newSettings.boxMode) {
      userProperties.setProperty('boxMode', newSettings.boxMode);
    }
    if (newSettings.boxDigits) {
      userProperties.setProperty('boxDigits', newSettings.boxDigits);
    }
    if (newSettings.maxLowStockDisplay) {
      userProperties.setProperty('maxLowStockDisplay', newSettings.maxLowStockDisplay);
    }
    
    // 음성 설정 처리
    if (newSettings.voiceSettings) {
      const voiceResult = saveVoiceSettings(newSettings.voiceSettings);
      if (!voiceResult.success) {
        return voiceResult;
      }
    }

    // 판매 기간 설정 추가
    if (newSettings.salesPeriodShort) {
      userProperties.setProperty('salesPeriodShort', newSettings.salesPeriodShort);
    }
    if (newSettings.salesPeriodLong) {
      userProperties.setProperty('salesPeriodLong', newSettings.salesPeriodLong);
    }
    if (newSettings.salesThresholdHot) {
      userProperties.setProperty('salesThresholdHot', newSettings.salesThresholdHot);
    }
    if (newSettings.salesThresholdPopular) {
      userProperties.setProperty('salesThresholdPopular', newSettings.salesThresholdPopular);
    }
    if (newSettings.salesThresholdNormal) {
      userProperties.setProperty('salesThresholdNormal', newSettings.salesThresholdNormal);
    }
    
    return { success: true, message: '설정이 저장되었습니다.' };
  } catch (error) {
    console.error('설정 저장 실패:', error);
    return { success: false, message: '설정 저장에 실패했습니다.' };
  }
}

// 캐시 관리를 위한 함수 추가
function refreshBoxBarcodeCache() {
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEYS.BOX_BARCODES);
  return getBoxBarcodesFromSheet();
}

// 박스 바코드 관리 함수들 추가
function addBoxBarcode(barcode, name) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let sheet = ss.getSheetByName('박스바코드');
    
    // 시트가 없으면 생성
    if (!sheet) {
      sheet = ss.insertSheet('박스바코드');
      // 헤더 설정
      sheet.getRange(1, 1, 1, 4).setValues([['바코드', '이름', '등록일', '등록자']]);
      sheet.getRange(1, 1, 1, 4)
        .setBackground('#f0f0f0')
        .setFontWeight('bold');
      
      // 열 너비 조정
      sheet.setColumnWidth(1, 150); // 바코드
      sheet.setColumnWidth(2, 150); // 이름
      sheet.setColumnWidth(3, 120); // 등록일
      sheet.setColumnWidth(4, 150); // 등록자
    }
    
    // 중복 체크
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === barcode) {
        return { success: false, message: '이미 등록된 바코드입니다.' };
      }
    }
    
    // 추가
    const newRow = [
      barcode,
      name || `박스 ${data.length}`,
      new Date(),
      Session.getActiveUser().getEmail()
    ];
    
    sheet.appendRow(newRow);
    
    // 전체 박스 바코드 반환
    const boxBarcodes = getBoxBarcodesFromSheet();
    
    return { success: true, boxBarcodes: boxBarcodes };
  } catch (error) {
    console.error('박스 바코드 추가 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 박스 바코드 삭제
function removeBoxBarcode(barcode) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName('박스바코드');
    
    if (!sheet) {
      return { success: false, message: '박스바코드 시트가 없습니다.' };
    }
    
    const data = sheet.getDataRange().getValues();
    
    // 해당 바코드 행 찾기
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === barcode) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    
    // 전체 박스 바코드 반환
    const boxBarcodes = getBoxBarcodesFromSheet();
    
    return { success: true, boxBarcodes: boxBarcodes };
  } catch (error) {
    console.error('박스 바코드 삭제 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 스프레드시트에서 박스 바코드 가져오기
function getBoxBarcodesFromSheet() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName('박스바코드');
    
    if (!sheet) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const boxBarcodes = [];
    
    // 헤더 제외하고 데이터 수집
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) { // 바코드가 있는 경우만
        boxBarcodes.push({
          barcode: String(data[i][0]),
          name: String(data[i][1] || ''),
          createdAt: data[i][2] ? new Date(data[i][2]).toISOString() : null
        });
      }
    }
    
    return boxBarcodes;
  } catch (error) {
    console.error('박스 바코드 조회 실패:', error);
    return [];
  }
}

// 박스 바코드 확인 함수
function isBoxBarcode(barcode) {
  const settings = getSettings();
  const boxBarcodes = settings.boxBarcodes || [];
  return boxBarcodes.some(box => box.barcode === barcode);
}

// 박스 정보 가져오기
function getBoxInfo(identifier) {
  const settings = getSettings();
  
  if (settings.boxMode === 'barcode') {
    // 바코드 모드
    return settings.boxBarcodes.find(box => box.barcode === identifier);
  } else {
    // 번호 모드
    return {
      barcode: identifier,
      name: `박스 ${identifier}`,
      isAutoNumber: true
    };
  }
}

// ===== 월간 예산 설정 가져오기 ===== 
function getMonthlyBudget() {
  const userProperties = PropertiesService.getUserProperties();
  return Number(userProperties.getProperty('monthlyBudget')) || 10000000;
}

// ===== 액션 처리 함수 ===== scripts.html에 추가
function handleAction(action) {
  switch(action) {
    case 'checkInventory':
      // 재고 확인이 필요한 상품 표시
      showFrequentNotOrdered();
      break;
    case 'viewBudget':
      // 예산 상세 보기
      showBudgetDetails();
      break;
    case 'confirmOrders':
      // 미확정 발주서로 이동
      switchTab('order');
      break;
  }
}

// ===== 자주 발주 but 미발주 상품 표시 =====
function showFrequentNotOrdered() {
  showLoading();
  
  google.script.run
    .withSuccessHandler(function(products) {
      hideLoading();
      
      const modalContent = `
        <h3>재고 확인 필요 상품</h3>
        <p>최근 7일간 발주하지 않은 자주 발주 상품입니다.</p>
        <div class="best-products-list">
          ${products.map(product => `
            <div class="best-product-item">
              <div class="product-info">
                <div class="product-name">${product.name}</div>
                <div class="product-details">
                  마지막 발주: ${product.lastOrderDate || '정보없음'} | 
                  평균 발주량: ${product.avgQuantity}개
                </div>
              </div>
              <button class="btn btn-primary" 
                      onclick="addToOrder('${product.barcode}')">
                발주 추가
              </button>
            </div>
          `).join('')}
        </div>
      `;
      
      showModal(modalContent);
    })
    .withFailureHandler(function(error) {
      hideLoading();
      showError('데이터 로드 실패');
    })
    .getFrequentNotOrderedProducts();
}

// ===== 예산 상세 보기 =====
function showBudgetDetails() {
  const budgetEl = document.getElementById('budget-rate').textContent;
  const usedAmount = document.getElementById('budget-text').textContent;
  
  const modalContent = `
    <h3>월 예산 상세</h3>
    <div style="padding: 20px;">
      <p><strong>현재 사용률:</strong> ${budgetEl}</p>
      <p><strong>사용 금액:</strong> ${usedAmount}</p>
      <div style="margin-top: 20px;">
        <label>월 예산 수정:</label>
        <input type="number" id="new-budget" class="form-input" 
               placeholder="새 예산 금액" style="margin: 10px 0;">
        <button class="btn btn-primary" onclick="updateMonthlyBudget()">
          예산 변경
        </button>
      </div>
    </div>
  `;
  
  showModal(modalContent);
}

// ===== 자주 발주했지만 최근 미발주 상품 ===== Code.gs에 추가
function getFrequentNotOrderedProducts() {
  try {
    const frequentBarcodes = getFrequentProductBarcodes();
    const recentOrders = getRecentOrderedBarcodes(7);
    
    // 미발주 바코드 찾기
    const notOrderedBarcodes = frequentBarcodes.filter(barcode => !recentOrders.has(barcode));
    
    // 상품 정보 가져오기
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    
    const products = [];
    
    notOrderedBarcodes.forEach(barcode => {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === barcode) {
          // 평균 발주량 계산
          const avgQuantity = calculateAverageOrderQuantity(barcode);
          const lastOrderDate = getLastOrderDate(barcode);
          
          products.push({
            barcode: barcode,
            name: data[i][1],
            option: data[i][2],
            supplierName: data[i][4],
            avgQuantity: avgQuantity,
            lastOrderDate: lastOrderDate
          });
          break;
        }
      }
    });
    
    return products.slice(0, 20); // 최대 20개
    
  } catch (error) {
    console.error('미발주 상품 조회 실패:', error);
    return [];
  }
}

// ===== 평균 발주량 계산 =====
function calculateAverageOrderQuantity(barcode) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    
    let totalQuantity = 0;
    let orderCount = 0;
    
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const sheetDate = parseSheetDate(sheetName.substring(0, 6));
        
        if (sheetDate >= threeMonthsAgo) {
          const data = sheet.getDataRange().getValues();
          
          for (let i = 1; i < data.length; i++) {
            if (String(data[i][0]) === barcode) {
              totalQuantity += Number(data[i][3]) || 0;
              orderCount++;
            }
          }
        }
      }
    });
    
    return orderCount > 0 ? Math.round(totalQuantity / orderCount) : 10;
    
  } catch (error) {
    return 10; // 기본값
  }
}

// ===== 마지막 발주일 조회 =====
function getLastOrderDate(barcode) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    
    let lastDate = null;
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const data = sheet.getDataRange().getValues();
        
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][0]) === barcode) {
            const sheetDate = parseSheetDate(sheetName.substring(0, 6));
            if (!lastDate || sheetDate > lastDate) {
              lastDate = sheetDate;
            }
          }
        }
      }
    });
    
    return lastDate ? Utilities.formatDate(lastDate, 'GMT+9', 'MM/dd') : null;
    
  } catch (error) {
    return null;
  }
}

// ===== 월간 리포트 생성 =====
function createMonthlyReport() {
  try {
    const now = new Date();
    const reportName = Utilities.formatDate(now, 'GMT+9', 'yyyy년 MM월 발주 리포트');
    
    // 새 스프레드시트 생성
    const newSS = SpreadsheetApp.create(reportName);
    const sheet = newSS.getActiveSheet();
    
    // 리포트 헤더
    sheet.getRange(1, 1).setValue(reportName).setFontSize(16).setFontWeight('bold');
    sheet.getRange(2, 1).setValue(`생성일: ${Utilities.formatDate(now, 'GMT+9', 'yyyy-MM-dd HH:mm')}`);
    
    // 월간 요약 데이터
    const dashboardData = getDashboardData();
    
    // 1. 발주 총액
    sheet.getRange(4, 1).setValue('1. 월간 발주 요약');
    sheet.getRange(5, 1).setValue('총 발주액:');
    sheet.getRange(5, 2).setValue(dashboardData.budgetStatus.used);
    sheet.getRange(6, 1).setValue('예산 대비:');
    sheet.getRange(6, 2).setValue(dashboardData.budgetStatus.percentage + '%');
    
    // 2. TOP 10 상품
    sheet.getRange(8, 1).setValue('2. TOP 10 발주 상품');
    const headers = ['순위', '상품명', '발주량', '금액'];
    sheet.getRange(9, 1, 1, 4).setValues([headers]).setFontWeight('bold');
    
    dashboardData.topProducts.forEach((product, index) => {
      sheet.getRange(10 + index, 1).setValue(index + 1);
      sheet.getRange(10 + index, 2).setValue(product.name);
      sheet.getRange(10 + index, 3).setValue(product.totalQuantity);
      sheet.getRange(10 + index, 4).setValue(product.totalAmount);
    });
    
    // 3. 카테고리별 분석
    const categoryRow = 22;
    sheet.getRange(categoryRow, 1).setValue('3. 카테고리별 발주 현황');
    sheet.getRange(categoryRow + 1, 1, 1, 3).setValues([['카테고리', '금액', '비율']]).setFontWeight('bold');
    
    dashboardData.categoryStats.forEach((cat, index) => {
      const total = dashboardData.categoryStats.reduce((sum, c) => sum + c.totalAmount, 0);
      sheet.getRange(categoryRow + 2 + index, 1).setValue(cat.category);
      sheet.getRange(categoryRow + 2 + index, 2).setValue(cat.totalAmount);
      sheet.getRange(categoryRow + 2 + index, 3).setValue((cat.totalAmount / total * 100).toFixed(1) + '%');
    });
    
    // 서식 설정
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 250);
    sheet.setColumnWidth(3, 100);
    sheet.setColumnWidth(4, 150);
    
    // 파일 URL 반환
    return {
      success: true,
      url: newSS.getUrl(),
      message: '월간 리포트가 생성되었습니다.'
    };
    
  } catch (error) {
    console.error('리포트 생성 실패:', error);
    return {
      success: false,
      message: '리포트 생성에 실패했습니다.'
    };
  }
}

// ===== 예산 알림 설정 =====
function setBudgetAlert() {
  const modalContent = `
    <h3>예산 알림 설정</h3>
    <div style="padding: 20px;">
      <label>
        <input type="checkbox" id="alert-80" checked> 
        예산 80% 도달 시 알림
      </label><br><br>
      <label>
        <input type="checkbox" id="alert-90" checked> 
        예산 90% 도달 시 알림
      </label><br><br>
      <label>
        <input type="checkbox" id="alert-over"> 
        예산 초과 시 알림
      </label><br><br>
      <button class="btn btn-primary" onclick="saveBudgetAlertSettings()">
        저장
      </button>
    </div>
  `;
  
  showModal(modalContent);
}

// ===== 제품 이슈사항 로드 =====
function loadProductIssues() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let issueSheet = ss.getSheetByName('제품이슈사항');
    
    if (!issueSheet) {
      // 시트가 없으면 생성
      issueSheet = ss.insertSheet('제품이슈사항');
      const headers = ['순번', '바코드', '상품명', '옵션', '공급사명', '메모', '비고', '등록일'];
      issueSheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold')
        .setBackground('#f0f0f0');
      
      // 컬럼 너비 조정
      issueSheet.setColumnWidth(1, 50);  // 순번
      issueSheet.setColumnWidth(2, 120); // 바코드
      issueSheet.setColumnWidth(3, 200); // 상품명
      issueSheet.setColumnWidth(4, 150); // 옵션
      issueSheet.setColumnWidth(5, 150); // 공급사명
      issueSheet.setColumnWidth(6, 100); // 메모
      issueSheet.setColumnWidth(7, 250); // 비고
      issueSheet.setColumnWidth(8, 100); // 등록일
    }
    
    const data = issueSheet.getDataRange().getValues();
    const issues = {};
    
    // 헤더 제외하고 데이터 수집
    for (let i = 1; i < data.length; i++) {
      if (data[i][1]) { // 바코드가 있는 경우
        const barcode = String(data[i][1]);
        issues[barcode] = {
          memo: data[i][5] || '',     // F열: 메모 (품절/오더중 등)
          remarks: data[i][6] || '',  // G열: 비고 (상세정보)
          registeredAt: data[i][7] || ''
        };
      }
    }
    
    return issues;
  } catch (error) {
    console.error('제품 이슈사항 로드 실패:', error);
    return {};
  }
}

// ===== 제품 이슈사항 추가/수정 =====
function updateProductIssue(issueData) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const issueSheet = ss.getSheetByName('제품이슈사항');
    
    if (!issueSheet) {
      return { success: false, message: '제품이슈사항 시트가 없습니다.' };
    }
    
    const data = issueSheet.getDataRange().getValues();
    let rowIndex = -1;
    
    // 기존 데이터 찾기
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === issueData.barcode) {
        rowIndex = i + 1; // 1-based index
        break;
      }
    }
    
    if (rowIndex > 0) {
      // 기존 데이터 수정
      issueSheet.getRange(rowIndex, 6).setValue(issueData.memo);
      issueSheet.getRange(rowIndex, 7).setValue(issueData.remarks);
      issueSheet.getRange(rowIndex, 8).setValue(new Date());
    } else {
      // 새 데이터 추가
      const newRow = issueSheet.getLastRow() + 1;
      const rowData = [
        newRow - 1, // 순번
        issueData.barcode,
        issueData.productName || '',
        issueData.option || '',
        issueData.supplierName || '',
        issueData.memo,
        issueData.remarks,
        new Date()
      ];
      issueSheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);
    }
    
    return { success: true, message: '제품 이슈사항이 저장되었습니다.' };
  } catch (error) {
    console.error('제품 이슈사항 저장 실패:', error);
    return { success: false, message: '저장 중 오류가 발생했습니다.' };
  }
}

// ===== 제품 이슈사항 삭제 =====
function deleteProductIssue(barcode) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const issueSheet = ss.getSheetByName('제품이슈사항');
    
    if (!issueSheet) {
      return { success: false, message: '제품이슈사항 시트가 없습니다.' };
    }
    
    const data = issueSheet.getDataRange().getValues();
    
    // 해당 바코드 찾아서 삭제
    for (let i = data.length - 1; i >= 1; i--) { // 역순으로 처리
      if (String(data[i][1]) === barcode) {
        issueSheet.deleteRow(i + 1);
        
        // 순번 재정렬
        updateIssueNumbers(issueSheet);
        
        return { success: true, message: '제품 이슈사항이 삭제되었습니다.' };
      }
    }
    
    return { success: false, message: '해당 제품을 찾을 수 없습니다.' };
  } catch (error) {
    console.error('제품 이슈사항 삭제 실패:', error);
    return { success: false, message: '삭제 중 오류가 발생했습니다.' };
  }
}

function clearOrderSheet(orderId) {
  try {
    if (!orderId) {
      return { success: false, message: '발주서 ID가 없습니다.' };
    }
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.' };
    }
    
    // 헤더 행(1-6행)은 유지하고 7행부터 삭제
    const lastRow = sheet.getLastRow();
    if (lastRow > 6) {
      sheet.deleteRows(7, lastRow - 6);
    }
    
    // 마지막 저장 시간 업데이트
    sheet.getRange(4, 5).setValue('최종저장:').setFontWeight('bold');
    sheet.getRange(4, 6).setValue(Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm:ss') + ' (초기화됨)');
    
    return {
      success: true,
      message: '발주서가 초기화되었습니다.'
    };
    
  } catch (error) {
    console.error('발주서 초기화 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// ===== 캐시된 자주 발주 바코드 가져오기 =====
function getCachedFrequentBarcodes() {
  // cacheManager 사용
  const cached = getCache(CACHE_KEYS.FREQUENT_BARCODES);
  
  if (cached) {
    return cached;
  }
  
  // 캐시가 없으면 실시간 계산 후 캐시 저장
  const barcodes = getFrequentProductBarcodes();
  setCache(CACHE_KEYS.FREQUENT_BARCODES, barcodes, CACHE_DURATION.LONG); // 6시간 캐시
  return barcodes;
}

function batchProcess(items, batchSize, processFunction) {
  const results = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));
    
    try {
      const batchResults = processFunction(batch);
      results.push(...batchResults);
      
      // 과부하 방지
      if (i + batchSize < items.length) {
        Utilities.sleep(100); // 0.1초 대기
      }
    } catch (error) {
      console.error(`배치 ${i/batchSize + 1} 처리 실패:`, error);
    }
  }
  
  return results;
}

// 공유 최근 상품 업데이트
function updateSharedRecentProducts(product) {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    
    // cacheManager 사용
    let recentProducts = getCache(CACHE_KEYS.SHARED_RECENT_PRODUCTS);
    
    if (!recentProducts) {
      // 캐시가 없으면 ScriptProperties에서 로드
      recentProducts = scriptProps.getProperty('SHARED_RECENT_PRODUCTS');
      recentProducts = recentProducts ? JSON.parse(recentProducts) : [];
    }
    
    // 중복 제거 후 최신 추가
    recentProducts = recentProducts.filter(p => p.barcode !== product.barcode);
    recentProducts.unshift({
      ...product,
      lastUsedBy: Session.getActiveUser().getEmail(),
      lastUsedAt: new Date().toISOString()
    });
    
    // 최근 30일 내 항목만 유지 (최대 500개)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    recentProducts = recentProducts
      .filter(p => new Date(p.lastUsedAt) > thirtyDaysAgo)
      .slice(0, 500);
    
    // 저장
    const dataStr = JSON.stringify(recentProducts);
    setCache(CACHE_KEYS.SHARED_RECENT_PRODUCTS, recentProducts, CACHE_DURATION.MEDIUM);
    scriptProps.setProperty('SHARED_RECENT_PRODUCTS', dataStr);
    
    return { success: true };
    
  } catch (error) {
    console.error('공유 최근 상품 업데이트 실패:', error);
    return { success: false, error: error.toString() };
  }
}

// 공유 최근 상품 가져오기
function getSharedRecentProducts() {
  try {
    // cacheManager 사용
    let recentProducts = getCache(CACHE_KEYS.SHARED_RECENT_PRODUCTS);
    
    if (!recentProducts) {
      const scriptProps = PropertiesService.getScriptProperties();
      const stored = scriptProps.getProperty('SHARED_RECENT_PRODUCTS');
      
      if (stored) {
        recentProducts = JSON.parse(stored);
        // 캐시에 저장
        setCache(CACHE_KEYS.SHARED_RECENT_PRODUCTS, recentProducts, CACHE_DURATION.MEDIUM);
      }
    }
    
    return recentProducts || [];
    
  } catch (error) {
    console.error('공유 최근 상품 조회 실패:', error);
    return [];
  }
}

// 사용자별 최근 상품 가져오기
function getUserRecentProducts() {
  try {
    const userProps = PropertiesService.getUserProperties();
    const recentProducts = userProps.getProperty('USER_RECENT_PRODUCTS');
    return recentProducts ? JSON.parse(recentProducts) : [];
  } catch (error) {
    console.error('사용자 최근 상품 조회 실패:', error);
    return [];
  }
}

// 이번 달 발주 상품 가져오기
function getCurrentMonthOrderedProducts() {
  try {
    // cacheManager 사용
    const cacheKey = CACHE_KEYS.CURRENT_MONTH_PRODUCTS;
    
    // 캐시 확인
    let cached = getCache(cacheKey);
    if (cached) {
      return cached;
    }
    
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const uniqueBarcodes = new Set();
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const dateStr = sheetName.substring(0, 6);
        const year = 2000 + parseInt(dateStr.substring(0, 2));
        const month = parseInt(dateStr.substring(2, 4)) - 1;
        
        if (year === currentYear && month === currentMonth) {
          const data = sheet.getDataRange().getValues();
          
          for (let i = 1; i < data.length; i++) {
            if (data[i][0]) {
              uniqueBarcodes.add(String(data[i][0]));
            }
          }
        }
      }
    });
    
    // 바코드로 상품 정보 가져오기
    const products = getProductsByBarcodes(Array.from(uniqueBarcodes));
    
    // 캐시 저장 (30분)
    setCache(cacheKey, products, CACHE_DURATION.SHORT * 6);
    
    return products;
    
  } catch (error) {
    console.error('이번 달 발주 상품 조회 실패:', error);
    return [];
  }
}

// ===== 과거 발주 데이터 간단 임포트 =====
function importHistoricalData(sourceUrl) {
  try {
    // URL에서 스프레드시트 ID 추출
    const idMatch = sourceUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const sourceId = idMatch ? idMatch[1] : sourceUrl;
    
    const sourceSpreadsheet = SpreadsheetApp.openById(sourceId);
    const targetSpreadsheet = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = sourceSpreadsheet.getSheets();
    
    let importedCount = 0;
    let skippedCount = 0;
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      // 날짜 패턴 찾기 (YYMMDD, YYYY-MM-DD, YYYY.MM.DD 등)
      const patterns = [
        /(\d{2})(\d{2})(\d{2})/, // YYMMDD
        /(\d{4})[.-](\d{2})[.-](\d{2})/, // YYYY-MM-DD or YYYY.MM.DD
        /(\d{2})[.-](\d{2})[.-](\d{2})/ // YY-MM-DD
      ];
      
      let dateFound = false;
      let formattedDate = '';
      
      for (const pattern of patterns) {
        const match = sheetName.match(pattern);
        if (match) {
          let year, month, day;
          
          if (match[1].length === 4) {
            // YYYY 형식
            year = parseInt(match[1]);
            month = parseInt(match[2]);
            day = parseInt(match[3]);
          } else {
            // YY 형식
            year = 2000 + parseInt(match[1]);
            month = parseInt(match[2]);
            day = parseInt(match[3]);
          }
          
          // YYMMDD 형식으로 통일
          formattedDate = `${String(year).slice(-2).padStart(2, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
          dateFound = true;
          break;
        }
      }
      
      if (dateFound) {
        try {
          // 중복 확인
          const newSheetName = `${formattedDate} 발주서`;
          const existingSheet = targetSpreadsheet.getSheetByName(newSheetName);
          
          if (existingSheet) {
            skippedCount++;
            return;
          }
          
          // 시트 복사
          const copiedSheet = sheet.copyTo(targetSpreadsheet);
          copiedSheet.setName(newSheetName);
          
          // 데이터 형식 조정
          adjustSheetFormat(copiedSheet);
          
          importedCount++;
        } catch (error) {
          console.error(`시트 복사 실패 (${sheetName}):`, error);
        }
      }
    });
    
    // 캐시 초기화
    CacheService.getScriptCache().removeAll(['frequentItems', 'frequentBarcodes']);
    
    return {
      success: true,
      imported: importedCount,
      skipped: skippedCount,
      total: sheets.length
    };
    
  } catch (error) {
    console.error('데이터 임포트 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// ===== 시트 형식 조정 =====
function adjustSheetFormat(sheet) {
  try {
    const headers = sheet.getRange(1, 1, 1, 20).getValues()[0];
    
    // 최소 필수 컬럼 확인
    const requiredColumns = {
      barcode: false,
      name: false,
      quantity: false
    };
    
    // 컬럼 인덱스 찾기
    headers.forEach((header, index) => {
      const headerLower = header.toString().toLowerCase();
      
      if (headerLower.includes('바코드') || headerLower.includes('barcode') || headerLower.includes('코드')) {
        requiredColumns.barcode = index + 1;
      } else if (headerLower.includes('상품명') || headerLower.includes('품명') || headerLower.includes('name')) {
        requiredColumns.name = index + 1;
      } else if (headerLower.includes('수량') || headerLower.includes('quantity')) {
        requiredColumns.quantity = index + 1;
      }
    });
    
    // 필수 컬럼이 없으면 기본 구조로 가정
    if (!requiredColumns.barcode || !requiredColumns.name) {
      console.log('표준 형식이 아닌 시트:', sheet.getName());
    }
    
  } catch (error) {
    console.error('시트 형식 조정 실패:', error);
  }
}

// Code.gs에 추가
function loadOrderItemsSafe(orderId) {
  try {
    return loadOrderItems(orderId);
  } catch (error) {
    console.error('loadOrderItemsSafe 에러:', error);
    return {
      success: false,
      message: error.toString(),
      items: []
    };
  }
}

// 발주서 저장 시 버전 관리 부분에서 17열로 확장
function saveToOrderSheetWithVersion(items) {
  const lockService = LockService.getScriptLock();
  
  try {
    lockService.waitLock(10000);
    
    const currentOrder = getCurrentOrder();
    if (!currentOrder) {
      return { success: false, message: '생성된 발주서가 없습니다.' };
    }
    
    const ss = SpreadsheetApp.openById(currentOrder.orderId);
    const sheet = ss.getSheetByName('발주서');
    
    // 버전 정보 읽기/업데이트
    let version = sheet.getRange(5, 2).getValue() || 0;
    version = parseInt(version) + 1;
    
    // 기존 데이터 삭제
    const lastRow = sheet.getLastRow();
    if (lastRow > 6) {
      sheet.deleteRows(7, lastRow - 6);
    }
    
    // 새 데이터 추가
    if (items.length > 0) {
      const data = items.map(item => {
        let stockAvailable = item.stockAvailable || '미확인';
        
        // 출고가능수량 계산
        let exportableQty = item.quantity; // 기본값은 요청수량
        
        if (stockAvailable === '품절') {
          exportableQty = 0;
        } else if (stockAvailable === '오더중') {
          exportableQty = 0;
        } else if (stockAvailable.includes('개만 가능')) {
          // "X개만 가능" 형식에서 숫자 추출
          const match = stockAvailable.match(/(\d+)개만 가능/);
          if (match) {
            const availableQty = parseInt(match[1]);
            exportableQty = Math.min(availableQty, item.quantity);
          }
        }
        // '가능'인 경우는 요청수량 그대로
        
        return [
          item.barcode,                    // A열
          item.name,                        // B열
          item.option,                      // C열
          item.quantity,                    // D열
          item.purchasePrice || 0,          // E열
          item.quantity * (item.purchasePrice || 0), // F열
          item.weight || '',                // G열
          item.priority || 3,               // H열
          item.comment || '',               // I열
          item.status || '대기',            // J열
          item.confirmedAt || '',           // K열
          stockAvailable,                   // L열: 재고가능여부
          item.supplierName || '',          // M열
          item.exportedAt || '',            // N열: 내보내기 시간
          item.csvConfirmed ? '✓' : '',    // O열: CSV 확인 여부
          item.boxNumbers || '',            // P열: 박스번호
          exportableQty                     // Q열: 출고가능수량
        ];
      });
      
      sheet.getRange(7, 1, data.length, 17).setValues(data);
      sheet.getRange(7, 12, data.length, 1).setNumberFormat('@'); // L열 텍스트 형식
      
      // 합계 추가
      const totalRow = 7 + items.length;
      sheet.getRange(totalRow, 5).setValue('합계:').setFontWeight('bold');
      sheet.getRange(totalRow, 6).setFormula(`=SUM(F7:F${totalRow-1})`).setFontWeight('bold');
    }
    
    // 버전 및 수정 정보 업데이트
    sheet.getRange(5, 1).setValue('버전:').setFontWeight('bold');
    sheet.getRange(5, 2).setValue(version);
    sheet.getRange(5, 3).setValue('수정자:').setFontWeight('bold');
    sheet.getRange(5, 4).setValue(Session.getActiveUser().getEmail());
    sheet.getRange(5, 5).setValue('수정시간:').setFontWeight('bold');
    sheet.getRange(5, 6).setValue(new Date());
    
    // 헤더 업데이트 - Q열 헤더명 변경
    const headers = sheet.getRange(6, 1, 1, 17).getValues()[0];
    if (headers[13] !== '내보내기시간') {
      sheet.getRange(6, 14).setValue('내보내기시간');
    }
    if (headers[14] !== 'CSV확인') {
      sheet.getRange(6, 15).setValue('CSV확인');
    }
    if (headers[15] !== '박스번호') {
      sheet.getRange(6, 16).setValue('박스번호');
    }
    if (headers[16] !== '출고가능수량') { // 헤더명 변경
      sheet.getRange(6, 17).setValue('출고가능수량');
    }
    
    return {
      success: true,
      message: `발주서가 저장되었습니다. (버전 ${version})`,
      savedCount: items.length,
      version: version
    };
    
  } catch (error) {
    console.error('발주서 저장 실패:', error);
    return {
      success: false,
      message: '저장에 실패했습니다: ' + error.toString()
    };
  } finally {
    lockService.releaseLock();
  }
}

// 3. 실시간 동기화 체크
function checkForUpdates(orderId, currentVersion) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) return { hasUpdate: false };
    
    const serverVersion = sheet.getRange(5, 2).getValue() || 0;
    const lastModifiedBy = sheet.getRange(5, 4).getValue() || '';
    const lastModifiedAt = sheet.getRange(5, 6).getValue() || '';
    
    if (parseInt(serverVersion) > parseInt(currentVersion)) {
      return {
        hasUpdate: true,
        serverVersion: serverVersion,
        modifiedBy: lastModifiedBy,
        modifiedAt: lastModifiedAt,
        message: `${lastModifiedBy}님이 발주서를 수정했습니다.`
      };
    }
    
    return { hasUpdate: false };
    
  } catch (e) {
    console.error('업데이트 체크 실패:', e);
    return { hasUpdate: false, error: e.toString() };
  }
}

// Code.gs에 추가할 함수들

// 발주서 마감 처리
function closeOrder(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    
    if (!orderSheet) {
      throw new Error('발주서 시트를 찾을 수 없습니다.');
    }
    
    // ⭐ 기존 저장 로직을 먼저 실행하여 Q열(출고가능수량) 계산 완료
    // 이미 saveToOrderSheetWithVersion에서 exportableQty가 계산되어 Q열에 저장됨
    
    // 1. 미출고 데이터 저장 (기존 로직)
    const undeliveredItems = saveUndeliveredItems(orderSheet);
    
    // 2. ⭐ 기존 계산 결과(Q열)를 활용하여 나머지 수량 자동 추가
    const autoAddedItems = addRemainingQuantityItems(orderSheet);
    
    // 3. 마감 상태 기록
    orderSheet.getRange(5, 2).setValue('마감됨');
    orderSheet.getRange(5, 3).setValue(new Date());
    orderSheet.getRange(5, 4).setValue(Session.getActiveUser().getEmail());
    
    // 4. 발주서 보호 설정
    const protection = orderSheet.protect()
      .setDescription('마감된 발주서')
      .setWarningOnly(false);
    
    const me = Session.getEffectiveUser();
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
    
    // 결과 메시지 생성
    let message = `발주서가 마감되었습니다.`;
    if (undeliveredItems.length > 0) {
      message += ` 미출고 이력: ${undeliveredItems.length}개`;
    }
    if (autoAddedItems.length > 0) {
      message += ` 자동 추가: ${autoAddedItems.length}개`;
    }
    
    return {
      success: true,
      undeliveredCount: undeliveredItems.length,
      autoAddedCount: autoAddedItems.length,
      message: message,
      autoAddedItems: autoAddedItems // 상세 정보 포함
    };
    
  } catch (error) {
    console.error('발주서 마감 중 오류:', error);
    return { success: false, error: error.toString() };
  }
}

// 나머지 수량을 새 항목으로 추가하는 함수 (Code.gs) - 기존 로직 활용
function addRemainingQuantityItems(orderSheet) {
  const lastRow = orderSheet.getLastRow();
  if (lastRow <= 6) return [];
  
  const numRows = lastRow - 6;
  const data = orderSheet.getRange(7, 1, numRows, 17).getValues(); // Q열까지 읽기
  
  const itemsToAdd = [];
  
  for (let i = 0; i < data.length; i++) {
    const barcode = data[i][0];
    const name = data[i][1];
    const option = data[i][2];
    const requestedQty = data[i][3] || 0;        // D열: 발주수량
    const stockAvailable = data[i][11];          // L열: 재고가능여부
    const supplierName = data[i][12];            // M열: 공급사명
    const exportableQty = data[i][16] || 0;      // Q열: 출고가능수량 (기존 계산 결과 사용)
    
    if (!barcode || !stockAvailable) continue;
    
    // ⭐ 기존 로직 활용: 요청수량 - 출고가능수량 = 나머지수량
    const remainingQty = Math.max(0, requestedQty - exportableQty);
    
    // 나머지 수량이 있으면 새 항목으로 추가
    if (remainingQty > 0) {
      // 기존 항목의 모든 정보를 복사하되, 수량과 상태만 변경
      const newRowData = [
        barcode,                                  // A열: 바코드
        name,                                     // B열: 상품명
        option,                                   // C열: 옵션
        remainingQty,                            // D열: 나머지 수량
        data[i][4] || 0,                         // E열: 구매가격 (기존과 동일)
        remainingQty * (data[i][4] || 0),        // F열: 금액 (나머지수량 × 단가)
        data[i][6] || '',                        // G열: 중량 (기존과 동일)
        1,                                       // H열: 우선순위 → 높음으로 설정
        `자동추가 (${stockAvailable} → ${remainingQty}개 부족)`, // I열: 코멘트
        '대기',                                   // J열: 상태 → 대기로 초기화
        '',                                      // K열: 확정시간 → 빈값
        '미확인',                                 // L열: 재고상태 → 미확인으로 초기화
        supplierName || '',                      // M열: 공급사명 (기존과 동일)
        '',                                      // N열: 내보내기시간 → 빈값
        '',                                      // O열: CSV확인 → 빈값
        '',                                      // P열: 박스번호 → 빈값
        remainingQty                             // Q열: 출고가능수량 → 나머지수량으로 설정
      ];
      
      itemsToAdd.push({
        rowData: newRowData,
        barcode: barcode,
        name: name,
        option: option || '',
        requestedQty: requestedQty,
        exportableQty: exportableQty,
        remainingQty: remainingQty,
        stockStatus: stockAvailable
      });
    }
  }
  
  // 새 항목들을 발주서에 추가
  if (itemsToAdd.length > 0) {
    const insertRow = orderSheet.getLastRow() + 1;
    const dataToInsert = itemsToAdd.map(item => item.rowData);
    
    orderSheet.getRange(insertRow, 1, itemsToAdd.length, 17).setValues(dataToInsert);
    
    // 새로 추가된 행에 배경색 적용 (구분용)
    const newRange = orderSheet.getRange(insertRow, 1, itemsToAdd.length, 17);
    newRange.setBackground('#fff3cd'); // 연한 노란색 배경
    
    console.log(`${itemsToAdd.length}개의 나머지 수량 항목이 자동 추가되었습니다.`);
  }
  
  // 반환 데이터 (UI 표시용)
  return itemsToAdd.map(item => ({
    barcode: item.barcode,
    name: item.name,
    option: item.option,
    requestedQty: item.requestedQty,
    exportableQty: item.exportableQty,
    remainingQty: item.remainingQty,
    stockStatus: item.stockStatus,
    comment: `자동추가 (${item.stockStatus} → ${item.remainingQty}개 부족)`
  }));
}

// 미출고 항목 저장
function saveUndeliveredItems(orderSheet) {
  const ss = orderSheet.getParent();  // 현재 시트의 스프레드시트 가져오기
  let undeliveredSheet = ss.getSheetByName('미출고이력');
  
  if (!undeliveredSheet) {
    undeliveredSheet = ss.insertSheet('미출고이력');
    undeliveredSheet.getRange(1, 1, 1, 8).setValues([
      ['발주일자', '상품코드', '상품명', '요청수량', '가능수량', '미출고수량', '상태', '메모']
    ]);
  }
  
  // 발주서 데이터는 7행부터 시작
  const lastRow = orderSheet.getLastRow();
  if (lastRow <= 6) return [];  // 데이터가 없으면 빈 배열 반환
  
  const numRows = lastRow - 6;
  const data = orderSheet.getRange(7, 1, numRows, 14).getValues();  // 7행부터 데이터 읽기
  
  const undeliveredItems = [];
  const orderDate = new Date().toLocaleDateString('ko-KR');
  
  for (let i = 0; i < data.length; i++) {
    const stockStatus = data[i][11];  // L열: 재고가능여부
    const requestedQty = data[i][3] || 0;  // D열: 발주수량
    
    if (stockStatus && (stockStatus.includes('개만 가능') || stockStatus === '품절' || stockStatus === '오더중')) {
      let availableQty = 0;
      let undeliveredQty = requestedQty;
      
      if (stockStatus.includes('개만 가능')) {
        const match = stockStatus.match(/(\d+)개만 가능/);
        if (match) {
          availableQty = parseInt(match[1]);
          undeliveredQty = requestedQty - availableQty;
        }
      }
      
      undeliveredItems.push([
        orderDate,
        data[i][0],  // 바코드
        data[i][1],  // 상품명
        requestedQty,
        availableQty,
        undeliveredQty,
        stockStatus,
        ''
      ]);
    }
  }
  
  if (undeliveredItems.length > 0) {
    const lastRow = undeliveredSheet.getLastRow();
    undeliveredSheet.getRange(lastRow + 1, 1, undeliveredItems.length, 8)
      .setValues(undeliveredItems);
  }
  
  return undeliveredItems;
}

// 미출고 항목 가져오기
function getUndeliveredItems() {
  try {
    // 현재 주문서의 스프레드시트에서 찾기
    const userProperties = PropertiesService.getUserProperties();
    const currentOrderJson = userProperties.getProperty('currentOrder');
    
    if (!currentOrderJson) return [];
    
    const currentOrder = JSON.parse(currentOrderJson);
    const ss = SpreadsheetApp.openById(currentOrder.orderId);
    const undeliveredSheet = ss.getSheetByName('미출고이력');
    
    if (!undeliveredSheet) return [];
    
    const data = undeliveredSheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    
    // 최근 미출고 항목만 반환 (중복 제거)
    const uniqueItems = {};
    for (let i = data.length - 1; i > 0; i--) {
      const code = data[i][1];
      if (!uniqueItems[code] && data[i][5] > 0) { // 미출고수량이 있는 경우만
        uniqueItems[code] = {
          code: code,
          name: data[i][2],
          undeliveredQty: data[i][5],
          lastStatus: data[i][6],
          lastDate: data[i][0]
        };
      }
    }
    
    return Object.values(uniqueItems);
  } catch (error) {
    console.error('미출고 항목 조회 중 오류:', error);
    return [];
  }
}

// 발주서 마감 여부 확인
function isOrderClosed(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    
    if (!orderSheet) return false;
    
    const status = orderSheet.getRange(5, 2).getValue();
    return status === '마감됨';
  } catch (e) {
    return false;
  }
}

// 발주서별 박스번호 가져오기
function getOrderBoxNumber(orderId) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const key = `boxNumber_${orderId}`;
    const boxNumber = scriptProperties.getProperty(key);
    return parseInt(boxNumber) || 1;
  } catch (error) {
    console.error('박스번호 조회 실패:', error);
    return 1;
  }
}

// 발주서별 박스번호 저장
function setOrderBoxNumber(orderId, boxNumber) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const key = `boxNumber_${orderId}`;
    scriptProperties.setProperty(key, String(boxNumber));
    return { success: true };
  } catch (error) {
    console.error('박스번호 저장 실패:', error);
    return { success: false, error: error.toString() };
  }
}

// 발주서 박스번호 초기화
function resetOrderBoxNumber(orderId) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const key = `boxNumber_${orderId}`;
    scriptProperties.deleteProperty(key);
    return { 
      success: true, 
      message: '이 발주서의 박스번호가 초기화되었습니다.' 
    };
  } catch (error) {
    console.error('박스번호 초기화 실패:', error);
    return { success: false, error: error.toString() };
  }
}
// 내보내기 완료된 항목 조회 - 바코드별로 그룹화하여 중복 제거
function getExportedItems(orderId) {
  try {
    if (!orderId) {
      return { success: false, message: '발주서 ID가 없습니다.', items: [] };
    }
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.', items: [] };
    }
    
    // 먼저 패킹리스트와 동기화
    syncWithPackingList(ss, sheet);
    
    // 바코드별로 그룹화할 맵
    const groupedItems = new Map();
    const lastRow = sheet.getLastRow();
    
    if (lastRow > 6) {
      const numRows = lastRow - 6;
      const data = sheet.getRange(7, 1, numRows, 17).getValues();
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        
        if (row[13] && row[0]) { // exportedAt && barcode
          const barcode = String(row[0]);
          const boxNumbers = row[15] || ''; // P열: 박스번호
          const exportableQty = row[16] || 0; // Q열: 출고가능수량
          
          // 박스번호에서 스캔 수량 계산
          let scannedQuantity = 0;
          if (boxNumbers) {
            const matches = boxNumbers.match(/\d+\((\d+)\)/g);
            if (matches) {
              matches.forEach(match => {
                const qty = parseInt(match.match(/\((\d+)\)/)[1]);
                scannedQuantity += qty;
              });
            }
          }
          
          const exportQuantity = exportableQty > 0 ? Number(exportableQty) : Number(row[3]);
          
          // 바코드가 이미 그룹에 있는지 확인
          if (groupedItems.has(barcode)) {
            const existingItem = groupedItems.get(barcode);
            
            // 수량 누적
            existingItem.quantity += exportQuantity;
            existingItem.originalQuantity += Number(row[3]) || 0;
            existingItem.scannedQuantity += scannedQuantity;
            
            // 박스번호 추가 (중복 제거)
            if (boxNumbers) {
              existingItem.boxNumbers = mergeBoxNumbers(existingItem.boxNumbers, boxNumbers);
            }
            
            // 행 인덱스 추가 (여러 행 추적용)
            existingItem.rowIndices.push(i + 7);
            
            // 내보내기 시간 업데이트 (가장 최근 것으로)
            if (row[13]) {
              const newExportTime = new Date(String(row[13]));
              const existingExportTime = new Date(existingItem.exportedAt);
              if (newExportTime > existingExportTime) {
                existingItem.exportedAt = String(row[13]);
                existingItem.exportStatus = `내보내기 완료 (${String(row[13])})`;
              }
            }
            
            // 남은 수량 재계산
            existingItem.remainingQuantity = existingItem.quantity - existingItem.scannedQuantity;
            
            // 출고 완료 여부 재계산
            existingItem.isFullyShipped = existingItem.scannedQuantity >= existingItem.quantity;
            
            // 부분 출고 정보 재계산
            existingItem.shippingInfo = (() => {
              if (!existingItem.boxNumbers) return null;
              let totalShipped = 0;
              const boxDetails = [];
              const matches = existingItem.boxNumbers.match(/\d+\((\d+)\)/g);
              if (matches) {
                matches.forEach(match => {
                  const boxNum = match.match(/(\d+)\(/)[1];
                  const qty = parseInt(match.match(/\((\d+)\)/)[1]);
                  totalShipped += qty;
                  boxDetails.push({ boxNumber: boxNum, quantity: qty });
                });
              }
              return {
                totalShipped: totalShipped,
                exportableQty: existingItem.quantity,
                isPartial: totalShipped > 0 && totalShipped < existingItem.quantity,
                isComplete: totalShipped >= existingItem.quantity,
                boxDetails: boxDetails
              };
            })();
            
          } else {
            // 새로운 바코드 항목 생성
            const item = {
              rowIndex: i + 7,
              rowIndices: [i + 7], // 여러 행 추적용
              barcode: barcode,
              name: String(row[1] || ''),
              option: String(row[2] || ''),
              quantity: exportQuantity,
              originalQuantity: Number(row[3]) || 0,
              purchasePrice: Number(row[4]) || 0,
              weight: String(row[6] || ''),
              priority: Number(row[7]) || 3,
              comment: String(row[8] || ''),
              status: String(row[9] || ''),
              stockAvailable: String(row[11] || ''),
              supplierName: String(row[12] || ''),
              exportedAt: String(row[13]),
              csvConfirmed: row[14] === '✓',
              boxNumbers: boxNumbers,
              scannedQuantity: scannedQuantity,
              remainingQuantity: exportQuantity - scannedQuantity,
              exportStatus: row[13] ? `내보내기 완료 (${String(row[13])})` : '',
              confirmedStatus: row[9] === '확정',
              
              // 출고 완료 여부 계산 (박스번호 기반)
              isFullyShipped: (() => {
                if (!boxNumbers) return false;
                let totalShipped = 0;
                const matches = boxNumbers.match(/\d+\((\d+)\)/g);
                if (matches) {
                  matches.forEach(match => {
                    const qty = parseInt(match.match(/\((\d+)\)/)[1]);
                    totalShipped += qty;
                  });
                }
                return totalShipped >= exportQuantity;
              })(),
              
              // 부분 출고 정보
              shippingInfo: (() => {
                if (!boxNumbers) return null;
                let totalShipped = 0;
                const boxDetails = [];
                const matches = boxNumbers.match(/\d+\((\d+)\)/g);
                if (matches) {
                  matches.forEach(match => {
                    const boxNum = match.match(/(\d+)\(/)[1];
                    const qty = parseInt(match.match(/\((\d+)\)/)[1]);
                    totalShipped += qty;
                    boxDetails.push({ boxNumber: boxNum, quantity: qty });
                  });
                }
                return {
                  totalShipped: totalShipped,
                  exportableQty: exportQuantity,
                  isPartial: totalShipped > 0 && totalShipped < exportQuantity,
                  isComplete: totalShipped >= exportQuantity,
                  boxDetails: boxDetails
                };
              })()
            };
            
            groupedItems.set(barcode, item);
          }
        }
      }
    }
    
    // Map을 배열로 변환하고 남은 수량이 있는 항목만 필터링
    const items = Array.from(groupedItems.values())
      .filter(item => item.remainingQuantity > 0)
      .sort((a, b) => {
        // 우선순위로 정렬, 같으면 이름으로 정렬
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.name.localeCompare(b.name);
      });
    
    // 발주서별 현재 박스번호 가져오기
    let currentBoxNumber = 1;
    try {
      currentBoxNumber = getOrderBoxNumber(orderId);
    } catch (e) {
      // 무시
    }
    
    return { 
      success: true, 
      items: items || [],
      currentBoxNumber: currentBoxNumber || 1,
      message: `${items.length}개 항목을 로드했습니다. (그룹화됨)`
    };
    
  } catch (error) {
    console.error('내보내기 항목 조회 실패:', error);
    return { 
      success: false, 
      message: error.toString(),
      items: [],
      currentBoxNumber: 1
    };
  }
}

// 박스번호 병합 헬퍼 함수
function mergeBoxNumbers(existing, newNumbers) {
  if (!existing) return newNumbers;
  if (!newNumbers) return existing;
  
  // 박스번호를 파싱하여 Map으로 관리
  const boxMap = new Map();
  
  // 기존 박스번호 파싱
  const existingMatches = existing.match(/(\d+)\((\d+)\)/g);
  if (existingMatches) {
    existingMatches.forEach(match => {
      const boxMatch = match.match(/(\d+)\((\d+)\)/);
      const boxNum = boxMatch[1];
      const qty = parseInt(boxMatch[2]);
      boxMap.set(boxNum, (boxMap.get(boxNum) || 0) + qty);
    });
  }
  
  // 새 박스번호 파싱
  const newMatches = newNumbers.match(/(\d+)\((\d+)\)/g);
  if (newMatches) {
    newMatches.forEach(match => {
      const boxMatch = match.match(/(\d+)\((\d+)\)/);
      const boxNum = boxMatch[1];
      const qty = parseInt(boxMatch[2]);
      boxMap.set(boxNum, (boxMap.get(boxNum) || 0) + qty);
    });
  }
  
  // Map을 문자열로 변환
  const result = [];
  const sortedBoxNumbers = Array.from(boxMap.keys()).sort((a, b) => parseInt(a) - parseInt(b));
  
  sortedBoxNumbers.forEach(boxNum => {
    result.push(`${boxNum}(${boxMap.get(boxNum)})`);
  });
  
  return result.join(', ');
}

// 박스 정보 확인 함수 - 번호와 바코드 모두 지원
function isBoxIdentifier(identifier) {
  const settings = getSettings();
  
  if (settings.boxMode === 'barcode') {
    // 바코드 모드: 등록된 바코드인지 확인
    return settings.boxBarcodes.some(box => box.barcode === identifier);
  } else {
    // 번호 모드: 숫자이고 설정된 자릿수인지 확인
    const digits = parseInt(settings.boxDigits) || 3;
    return identifier.length === digits && /^\d+$/.test(identifier);
  }
}

// 출고 데이터 저장 - 같은 바코드의 여러 행에 분산 저장
function saveShippingData(orderId, shippingData) {
  const lockService = LockService.getScriptLock();
  
  try {
    if (!lockService.tryLock(5000)) {
      throw new Error('다른 사용자가 저장 중입니다. 잠시 후 다시 시도해주세요.');
    }
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      throw new Error('발주서 시트를 찾을 수 없습니다.');
    }
    
    // 먼저 전체 데이터를 읽어서 바코드별로 인덱싱
    const lastRow = sheet.getLastRow();
    const allData = sheet.getRange(7, 1, lastRow - 6, 17).getValues();
    const barcodeRows = new Map(); // 바코드별 행 정보 저장
    
    // 바코드별로 행 정보 수집 (내보내기된 항목만)
    allData.forEach((row, index) => {
      if (row[0] && row[13]) { // 바코드가 있고 내보내기 시간이 있는 경우
        const barcode = String(row[0]);
        if (!barcodeRows.has(barcode)) {
          barcodeRows.set(barcode, []);
        }
        barcodeRows.get(barcode).push({
          rowIndex: index + 7,
          exportableQty: row[16] || row[3], // Q열 또는 D열
          existingBoxNumbers: row[15] || '', // P열
          scannedQty: 0 // 기존 스캔 수량 계산할 예정
        });
      }
    });
    
    // 각 행의 기존 스캔 수량 계산
    barcodeRows.forEach((rows, barcode) => {
      rows.forEach(rowInfo => {
        if (rowInfo.existingBoxNumbers) {
          const matches = rowInfo.existingBoxNumbers.match(/\d+\((\d+)\)/g);
          if (matches) {
            let scanned = 0;
            matches.forEach(match => {
              const qty = parseInt(match.match(/\((\d+)\)/)[1]);
              scanned += qty;
            });
            rowInfo.scannedQty = scanned;
          }
        }
      });
    });
    
    const timestamp = new Date();
    const packingDataArray = [];
    
    // 각 제품별로 처리
    shippingData.items.forEach(item => {
      const barcode = item.barcode;
      const rows = barcodeRows.get(barcode);
      
      if (!rows || rows.length === 0) {
        console.error(`바코드 ${barcode}에 대한 행을 찾을 수 없습니다.`);
        return;
      }
      
      // 스캔된 수량을 여러 행에 분배
      let remainingToScan = item.scannedInThisBox;
      
      // 남은 수량이 있는 행부터 채우기
      const availableRows = rows
        .filter(r => r.exportableQty - r.scannedQty > 0)
        .sort((a, b) => a.rowIndex - b.rowIndex); // 위쪽 행부터
      
      availableRows.forEach(rowInfo => {
        if (remainingToScan <= 0) return;
        
        const availableInRow = rowInfo.exportableQty - rowInfo.scannedQty;
        const toScanInRow = Math.min(remainingToScan, availableInRow);
        
        if (toScanInRow > 0) {
          // 이 행의 박스번호 업데이트
          const newBoxNumber = `${shippingData.boxNumber}(${toScanInRow})`;
          let updatedBoxNumbers = rowInfo.existingBoxNumbers;
          
          if (updatedBoxNumbers) {
            // 같은 박스번호가 이미 있는지 확인
            const boxRegex = new RegExp(`${shippingData.boxNumber}\\((\\d+)\\)`);
            const existingMatch = updatedBoxNumbers.match(boxRegex);
            
            if (existingMatch) {
              // 같은 박스번호가 있으면 수량 업데이트
              const existingQty = parseInt(existingMatch[1]);
              updatedBoxNumbers = updatedBoxNumbers.replace(
                boxRegex,
                `${shippingData.boxNumber}(${existingQty + toScanInRow})`
              );
            } else {
              // 새 박스번호 추가
              updatedBoxNumbers += `, ${newBoxNumber}`;
            }
          } else {
            updatedBoxNumbers = newBoxNumber;
          }
          
          // P열 업데이트
          sheet.getRange(rowInfo.rowIndex, 16).setValue(updatedBoxNumbers);
          
          // 출고 완료 상태 확인 및 업데이트
          if (rowInfo.scannedQty + toScanInRow >= rowInfo.exportableQty) {
            const currentStatus = sheet.getRange(rowInfo.rowIndex, 10).getValue();
            // 기존 상태가 '확정'이 아니면 '출고완료'로 변경
            if (currentStatus !== '확정') {
              sheet.getRange(rowInfo.rowIndex, 10).setValue('출고완료');
            }
          }
          
          remainingToScan -= toScanInRow;
          
          // 패킹리스트용 데이터 추가
          packingDataArray.push({
            barcode: item.barcode,
            name: item.name,
            option: item.option,
            quantity: toScanInRow,
            boxNumber: shippingData.boxNumber,
            comment: item.comment,
            stockAvailable: item.stockAvailable,
            timestamp: timestamp
          });
        }
      });
      
      if (remainingToScan > 0) {
        console.warn(`바코드 ${barcode}: ${remainingToScan}개를 저장할 행이 부족합니다.`);
      }
    });
    
    // 출고이력 저장 (saveShippingHistory 함수 호출)
    saveShippingHistory(ss, shippingData, shippingData.boxNumber);
    
    // 패킹리스트 업데이트
    updatePackingListWithBatch(ss, packingDataArray);
    
    // 박스번호 증가 및 저장
    const nextBoxNumber = parseInt(shippingData.boxNumber) + 1;
    setOrderBoxNumber(orderId, nextBoxNumber);
    
    return {
      success: true,
      nextBoxNumber: nextBoxNumber,
      savedCount: shippingData.items.length,
      message: `${shippingData.boxNumber}번 박스 출고 완료`
    };
    
  } catch (error) {
    console.error('출고 데이터 저장 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  } finally {
    lockService.releaseLock();
  }
}

function updatePackingListWithBatch(spreadsheet, packingDataArray) {
  try {
    let packingSheet = spreadsheet.getSheetByName('패킹리스트');
    
    if (!packingSheet) {
      packingSheet = spreadsheet.insertSheet('패킹리스트');
      const headers = ['바코드', '상품명', '옵션', '수량', '박스번호', '메모', '비고', '스캔시간'];
      packingSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      packingSheet.getRange(1, 1, 1, headers.length)
        .setBackground('#f0f0f0')
        .setFontWeight('bold');
      
      // 열 너비 조정
      packingSheet.setColumnWidths(1, 8, [120, 200, 150, 60, 80, 150, 100, 150]);
    }
    
    // 기존 데이터 로드
    const lastRow = packingSheet.getLastRow();
    const existingData = lastRow > 1 ? 
      packingSheet.getRange(2, 1, lastRow - 1, 5).getValues() : [];
    
    // 기존 데이터 맵 생성 (정규화된 키 사용)
    const existingMap = new Map();
    existingData.forEach((row, index) => {
      if (row[0] && row[4]) { // 바코드와 박스번호가 있는 경우만
        const normalizedBox = parseInt(row[4]).toString();
        const key = `${row[0]}-${normalizedBox}`;
        existingMap.set(key, {
          rowIndex: index + 2,
          quantity: row[3]
        });
      }
    });
    
    // 새 데이터 처리
    const newRows = [];
    const updates = [];
    
    packingDataArray.forEach(item => {
      const key = `${item.barcode}-${item.boxNumber}`;
      
      if (existingMap.has(key)) {
        // 기존 항목 업데이트 (수량 합산)
        const existing = existingMap.get(key);
        updates.push({
          row: existing.rowIndex,
          quantity: existing.quantity + item.quantity,
          memo: item.comment,
          stockAvailable: item.stockAvailable,
          timestamp: item.timestamp
        });
      } else {
        // 새 항목
        newRows.push([
          item.barcode,
          item.name,
          item.option,
          item.quantity,
          item.boxNumber,
          item.comment,
          item.stockAvailable,
          item.timestamp
        ]);
      }
    });
    
    // 업데이트 실행
    if (updates.length > 0) {
      updates.forEach(update => {
        packingSheet.getRange(update.row, 4).setValue(update.quantity);
        packingSheet.getRange(update.row, 6).setValue(update.memo);
        packingSheet.getRange(update.row, 7).setValue(update.stockAvailable);
        packingSheet.getRange(update.row, 8).setValue(update.timestamp);
      });
      console.log(`패킹리스트 ${updates.length}개 항목 업데이트`);
    }
    
    // 새 항목 추가
    if (newRows.length > 0) {
      const startRow = packingSheet.getLastRow() + 1;
      packingSheet.getRange(startRow, 1, newRows.length, 8).setValues(newRows);
      console.log(`패킹리스트 ${newRows.length}개 항목 추가`);
    }
    
    // 최종 업데이트 시간 기록
    packingSheet.getRange(1, 9).setValue('최종 업데이트:');
    packingSheet.getRange(1, 10).setValue(new Date());
    
  } catch (error) {
    console.error('패킹리스트 업데이트 실패:', error);
    throw error; // 상위로 에러 전파
  }
}

// syncWithPackingList 함수 로그 최소화
function syncWithPackingList(spreadsheet, orderSheet) {
  try {
    const packingSheet = spreadsheet.getSheetByName('패킹리스트');
    const historySheet = spreadsheet.getSheetByName('출고이력');
    
    const orderLastRow = orderSheet.getLastRow();
    if (orderLastRow <= 6) return;
    
    const orderRange = orderSheet.getRange(7, 1, orderLastRow - 6, 17);
    const orderData = orderRange.getValues();
    
    // 바코드 인덱스 맵 생성
    const barcodeToRowIndex = {};
    orderData.forEach((row, index) => {
      if (row[0]) {
        barcodeToRowIndex[row[0]] = index;
      }
    });
    
    // 1단계: 출고이력 데이터 수집
    const masterShippingData = {};
    
    if (historySheet && historySheet.getLastRow() > 1) {
      const historyData = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, 7).getValues();
      
      historyData.forEach(row => {
        const boxNumber = row[1] ? row[1].toString() : '';
        const barcode = row[2];
        const quantity = row[5];
        
        if (barcode && quantity && boxNumber) {
          const normalizedBox = boxNumber.match(/\d+/);
          if (normalizedBox) {
            const boxNum = parseInt(normalizedBox[0]).toString();
            
            if (!masterShippingData[barcode]) {
              masterShippingData[barcode] = {};
            }
            
            masterShippingData[barcode][boxNum] = 
              (masterShippingData[barcode][boxNum] || 0) + Number(quantity);
          }
        }
      });
    }
    
    // 2단계: 패킹리스트 데이터 보완
    if (packingSheet && packingSheet.getLastRow() > 1) {
      const packingData = packingSheet.getRange(2, 1, packingSheet.getLastRow() - 1, 5).getValues();
      
      packingData.forEach(row => {
        const barcode = row[0];
        const quantity = row[3];
        const boxNumber = row[4] ? row[4].toString() : '';
        
        if (barcode && quantity && boxNumber) {
          const normalizedBox = boxNumber.match(/\d+/);
          if (normalizedBox) {
            const boxNum = parseInt(normalizedBox[0]).toString();
            
            if (!masterShippingData[barcode]) {
              masterShippingData[barcode] = {};
            }
            
            if (!masterShippingData[barcode][boxNum]) {
              masterShippingData[barcode][boxNum] = Number(quantity);
            }
          }
        }
      });
    }
    
    // 3단계: 발주서 업데이트
    let updateCount = 0;
    
    Object.keys(masterShippingData).forEach(barcode => {
      const rowIndex = barcodeToRowIndex[barcode];
      if (rowIndex !== undefined) {
        const boxInfo = Object.entries(masterShippingData[barcode])
          .filter(([box, qty]) => qty > 0)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .map(([box, qty]) => `${box}(${qty})`)
          .join(', ');
        
        const currentValue = orderData[rowIndex][15] || '';
        
        if (currentValue !== boxInfo) {
          orderData[rowIndex][15] = boxInfo;
          updateCount++;
        }
        
        // 출고 완료 상태 확인
        const totalShipped = Object.values(masterShippingData[barcode])
          .reduce((sum, qty) => sum + qty, 0);
        const requestedQty = orderData[rowIndex][16] || orderData[rowIndex][3];
        
        if (totalShipped >= requestedQty && requestedQty > 0) {
          // 기존 상태가 '확정'이면 유지, 아니면 '출고완료'로 변경
          if (orderData[rowIndex][9] === '확정') {
            // 확정 상태는 유지 (출고 완료는 박스번호로 확인)
          } else if (orderData[rowIndex][9] !== '출고완료') {
            orderData[rowIndex][9] = '출고완료';
          }
        }
      }
    });
    
    // 변경사항이 있을 때만 저장
    if (updateCount > 0) {
      orderRange.setValues(orderData);
    }
    
  } catch (error) {
    console.error('동기화 실패:', error);
  }
}

function getCompletedShippingItems(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.', items: [] };
    }
    
    const items = [];
    const lastRow = sheet.getLastRow();
    
    if (lastRow > 6) {
      const numRows = lastRow - 6;
      // 필요한 열만 가져오기 (성능 개선)
      const data = sheet.getRange(7, 1, numRows, 17).getValues();
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        
        // 박스번호가 있는 항목만 (P열 - 인덱스 15)
        if (row[15]) {
          const boxNumbers = row[15];
          const exportableQty = row[16] || row[3]; // Q열 또는 D열
          
          // 스캔 수량 계산
          let scannedQuantity = 0;
          const matches = boxNumbers.match(/\d+\((\d+)\)/g);
          if (matches) {
            matches.forEach(match => {
              const qty = parseInt(match.match(/\((\d+)\)/)[1]);
              scannedQuantity += qty;
            });
          }
          
          // 출고 완료된 항목만 (남은 수량이 0 이하)
          if (scannedQuantity >= exportableQty) {
            const item = {
              barcode: String(row[0]),
              name: String(row[1] || ''),
              option: String(row[2] || ''),
              quantity: exportableQty,
              scannedQuantity: scannedQuantity,
              boxNumbers: boxNumbers,
              stockAvailable: String(row[11] || ''),
              status: String(row[9] || '')
            };
            
            items.push(item);
          }
        }
      }
    }
    
    return { 
      success: true, 
      items: items,
      message: `${items.length}개 출고 완료 항목`
    };
    
  } catch (error) {
    console.error('출고 완료 항목 조회 실패:', error);
    return { 
      success: false, 
      message: error.toString(),
      items: []
    };
  }
}

// 강제 동기화
function forceSyncPackingList(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    
    if (!orderSheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.' };
    }
    
    // 동기화 실행
    syncWithPackingList(ss, orderSheet);
    
    return {
      success: true,
      message: '출고 상태가 동기화되었습니다.'
    };
    
  } catch (error) {
    console.error('강제 동기화 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 진단 함수
function diagnoseShippingConsistency(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const result = {};
    
    // 패킹리스트 데이터
    const packingSheet = ss.getSheetByName('패킹리스트');
    if (packingSheet && packingSheet.getLastRow() > 1) {
      result.packingListData = packingSheet.getRange(2, 1, 
        packingSheet.getLastRow() - 1, 5).getValues();
    }
    
    // 출고이력 데이터
    const historySheet = ss.getSheetByName('출고이력');
    if (historySheet && historySheet.getLastRow() > 1) {
      result.historyData = historySheet.getRange(2, 1, 
        historySheet.getLastRow() - 1, 7).getValues();
    }
    
    // 발주서 P열 데이터
    const orderSheet = ss.getSheetByName('발주서');
    if (orderSheet && orderSheet.getLastRow() > 6) {
      const pColumnData = orderSheet.getRange(7, 16, 
        orderSheet.getLastRow() - 6, 1).getValues();
      result.orderSheetBoxes = pColumnData
        .filter(row => row[0])
        .map(row => row[0]);
    }
    
    // 불일치 분석
    if (result.packingListData && result.historyData) {
      const packingBoxes = new Set(result.packingListData.map(row => row[4]));
      const historyBoxes = new Set(result.historyData.map(row => row[1]));
      
      result.missingInPacking = [...historyBoxes].filter(box => !packingBoxes.has(box));
      result.missingInHistory = [...packingBoxes].filter(box => !historyBoxes.has(box));
    }
    
    return result;
    
  } catch (error) {
    console.error('진단 중 오류:', error);
    return { error: error.toString() };
  }
}

// 데이터 복구
function repairShippingData(orderId) {
  const lockService = LockService.getScriptLock();
  
  try {
    if (!lockService.tryLock(10000)) {
      return { success: false, message: '다른 작업이 진행 중입니다.' };
    }
    
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    const packingSheet = ss.getSheetByName('패킹리스트');
    const historySheet = ss.getSheetByName('출고이력');
    
    const repairLog = [];
    
    // 1. 출고이력에서 모든 출고 정보 수집
    const actualShippingData = {};
    
    if (historySheet && historySheet.getLastRow() > 1) {
      const historyData = historySheet.getRange(2, 1, 
        historySheet.getLastRow() - 1, 7).getValues();
      
      historyData.forEach(row => {
        const boxNumber = row[1] ? row[1].toString() : '';
        const barcode = row[2];
        const quantity = row[5];
        
        if (boxNumber && barcode && quantity) {
          // 박스 번호 정규화 (숫자만 추출)
          const normalizedBox = boxNumber.match(/\d+/);
          if (normalizedBox) {
            const boxNum = parseInt(normalizedBox[0]).toString();
            
            if (!actualShippingData[barcode]) {
              actualShippingData[barcode] = {};
            }
            
            actualShippingData[barcode][boxNum] = 
              (actualShippingData[barcode][boxNum] || 0) + quantity;
          }
        }
      });
      
      repairLog.push(`출고이력에서 ${Object.keys(actualShippingData).length}개 바코드 데이터 수집`);
    }
    
    // 2. 발주서 P열 업데이트
    if (orderSheet && orderSheet.getLastRow() > 6) {
      const orderData = orderSheet.getRange(7, 1, 
        orderSheet.getLastRow() - 6, 17).getValues();
      
      let updateCount = 0;
      
      for (let i = 0; i < orderData.length; i++) {
        const barcode = orderData[i][0];
        
        if (barcode && actualShippingData[barcode]) {
          // 박스 정보 재구성 (정렬된 순서로)
          const boxInfo = Object.entries(actualShippingData[barcode])
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([box, qty]) => `${box}(${qty})`)
            .join(', ');
          
          const currentValue = orderData[i][15] || '';
          
          if (currentValue !== boxInfo) {
            orderSheet.getRange(i + 7, 16).setValue(boxInfo);
            updateCount++;
            repairLog.push(`${barcode}: "${currentValue}" → "${boxInfo}"`);
          }
          
          // 출고 완료 상태 확인
          const totalShipped = Object.values(actualShippingData[barcode])
            .reduce((sum, qty) => sum + qty, 0);
          const requestedQty = orderData[i][16] || orderData[i][3];
          
          if (totalShipped >= requestedQty && orderData[i][9] !== '출고완료') {
            orderSheet.getRange(i + 7, 10).setValue('출고완료');
          }
        }
      }
      
      repairLog.push(`발주서 ${updateCount}개 항목 업데이트`);
    }
    
    // 3. 패킹리스트 재생성
    if (packingSheet) {
      // 패킹리스트 클리어 및 재생성
      packingSheet.clear();
      
      const headers = ['바코드', '상품명', '옵션', '수량', '박스번호', '메모', '비고', '스캔시간'];
      packingSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      packingSheet.getRange(1, 1, 1, headers.length)
        .setBackground('#f0f0f0')
        .setFontWeight('bold');
      
      // 데이터 재구성
      const newPackingData = [];
      
      if (orderSheet) {
        const orderData = orderSheet.getRange(7, 1, 
          orderSheet.getLastRow() - 6, 17).getValues();
        
        orderData.forEach(row => {
          const barcode = row[0];
          
          if (barcode && actualShippingData[barcode]) {
            Object.entries(actualShippingData[barcode]).forEach(([boxNum, qty]) => {
              newPackingData.push([
                barcode,
                row[1], // 상품명
                row[2], // 옵션
                qty,
                boxNum,
                row[8], // 코멘트
                row[11], // 재고상태
                new Date()
              ]);
            });
          }
        });
      }
      
      if (newPackingData.length > 0) {
        // 박스 번호로 정렬
        newPackingData.sort((a, b) => parseInt(a[4]) - parseInt(b[4]));
        
        packingSheet.getRange(2, 1, newPackingData.length, 8)
          .setValues(newPackingData);
          
        repairLog.push(`패킹리스트 ${newPackingData.length}개 항목 재생성`);
      }
    }
    
    console.log('복구 로그:\n' + repairLog.join('\n'));
    
    return {
      success: true,
      message: '출고 데이터가 복구되었습니다.',
      repairLog: repairLog
    };
    
  } catch (error) {
    console.error('데이터 복구 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  } finally {
    lockService.releaseLock();
  }
}

// ===== Code.gs에 추가할 검증 함수들 (계속) =====

// 상태 검증
function validateShippingState(orderId, boxNumber) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const historySheet = ss.getSheetByName('출고이력');
    
    if (!historySheet) {
      return { isValid: true, message: '출고이력 없음' };
    }
    
    // 현재 박스 번호가 이미 사용되었는지 확인
    const lastRow = historySheet.getLastRow();
    if (lastRow > 1) {
      const historyData = historySheet.getRange(2, 2, lastRow - 1, 1).getValues();
      
      for (let i = 0; i < historyData.length; i++) {
        const existingBox = historyData[i][0] ? historyData[i][0].toString() : '';
        const normalizedExisting = existingBox.match(/\d+/);
        
        if (normalizedExisting && parseInt(normalizedExisting[0]) === parseInt(boxNumber)) {
          return { 
            isValid: false, 
            message: `${boxNumber}번 박스는 이미 사용되었습니다.`,
            suggestion: getNextAvailableBoxNumber(ss)
          };
        }
      }
    }
    
    return { isValid: true };
    
  } catch (error) {
    console.error('상태 검증 실패:', error);
    return { isValid: true }; // 에러 시 진행 허용
  }
}

// 다음 사용 가능한 박스 번호 찾기
function getNextAvailableBoxNumber(spreadsheet) {
  try {
    const historySheet = spreadsheet.getSheetByName('출고이력');
    if (!historySheet || historySheet.getLastRow() <= 1) {
      return 1;
    }
    
    const boxNumbers = historySheet.getRange(2, 2, historySheet.getLastRow() - 1, 1)
      .getValues()
      .map(row => {
        const box = row[0] ? row[0].toString() : '';
        const match = box.match(/\d+/);
        return match ? parseInt(match[0]) : 0;
      })
      .filter(num => num > 0);
    
    if (boxNumbers.length === 0) {
      return 1;
    }
    
    const maxBox = Math.max(...boxNumbers);
    return maxBox + 1;
    
  } catch (error) {
    console.error('박스 번호 조회 실패:', error);
    return 1;
  }
}

// 무결성 체크
function checkShippingIntegrity(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const issues = [];
    
    // 1. 박스 번호 형식 체크
    const orderSheet = ss.getSheetByName('발주서');
    if (orderSheet && orderSheet.getLastRow() > 6) {
      const pColumn = orderSheet.getRange(7, 16, orderSheet.getLastRow() - 6, 1).getValues();
      
      pColumn.forEach((row, index) => {
        if (row[0]) {
          // 비정규화된 박스 번호 체크
          const matches = row[0].match(/(\d+)\(/g);
          if (matches) {
            matches.forEach(match => {
              const boxNum = match.replace('(', '');
              if (boxNum.startsWith('0') && boxNum !== '0') {
                issues.push({
                  type: 'format',
                  row: index + 7,
                  value: row[0],
                  message: `비정규화된 박스 번호: ${boxNum}`
                });
              }
            });
          }
        }
      });
    }
    
    // 2. 중복 체크
    const packingSheet = ss.getSheetByName('패킹리스트');
    if (packingSheet && packingSheet.getLastRow() > 1) {
      const packingData = packingSheet.getRange(2, 1, 
        packingSheet.getLastRow() - 1, 5).getValues();
      
      const seen = new Set();
      packingData.forEach((row, index) => {
        const key = `${row[0]}-${row[4]}`; // 바코드-박스번호
        if (seen.has(key)) {
          issues.push({
            type: 'duplicate',
            row: index + 2,
            key: key,
            message: `중복 항목: ${key}`
          });
        }
        seen.add(key);
      });
    }
    
    return {
      hasIssues: issues.length > 0,
      issues: issues,
      critical: issues.some(issue => issue.type === 'duplicate')
    };
    
  } catch (error) {
    console.error('무결성 체크 실패:', error);
    return { hasIssues: false };
  }
}

// 동기화 상태 확인
function getSyncStatus(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    const packingSheet = ss.getSheetByName('패킹리스트');
    const historySheet = ss.getSheetByName('출고이력');
    
    const status = {
      hasOrderSheet: !!orderSheet,
      hasPackingList: !!packingSheet,
      hasHistory: !!historySheet,
      orderItemCount: 0,
      packingItemCount: 0,
      historyItemCount: 0,
      lastHistoryDate: null
    };
    
    if (orderSheet && orderSheet.getLastRow() > 6) {
      const pColumnData = orderSheet.getRange(7, 16, orderSheet.getLastRow() - 6, 1).getValues();
      status.orderItemCount = pColumnData.filter(row => row[0]).length;
    }
    
    if (packingSheet && packingSheet.getLastRow() > 1) {
      status.packingItemCount = packingSheet.getLastRow() - 1;
    }
    
    if (historySheet && historySheet.getLastRow() > 1) {
      status.historyItemCount = historySheet.getLastRow() - 1;
      
      // 최근 출고 시간
      const lastDate = historySheet.getRange(historySheet.getLastRow(), 1).getValue();
      if (lastDate) {
        status.lastHistoryDate = Utilities.formatDate(lastDate, 'GMT+9', 'yyyy-MM-dd HH:mm:ss');
      }
    }
    
    return status;
    
  } catch (error) {
    console.error('상태 확인 실패:', error);
    return { error: error.toString() };
  }
}

// 출고 이력 저장
function saveShippingHistory(spreadsheet, shippingData, boxNumber) {
  let historySheet = spreadsheet.getSheetByName('출고이력');
  
  if (!historySheet) {
    historySheet = spreadsheet.insertSheet('출고이력');
    // 헤더 설정
    const headers = ['출고일시', '박스번호', '바코드', '상품명', '옵션', '수량', '담당자'];
    historySheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    historySheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  
  const timestamp = new Date();
  const user = Session.getActiveUser().getEmail();
  
  // 이력 데이터 생성
  const historyData = shippingData.items.map(item => [
    timestamp,
    boxNumber, // 박스 번호만 저장
    item.barcode,
    item.name,
    item.option,
    item.scannedInThisBox,
    user
  ]);
  
  if (historyData.length > 0) {
    const lastRow = historySheet.getLastRow();
    historySheet.getRange(lastRow + 1, 1, historyData.length, 7).setValues(historyData);
  }
}

function getShippingStats(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const historySheet = ss.getSheetByName('출고이력');
    
    if (!historySheet) {
      return {
        totalBoxes: 0,
        totalItems: 0,
        totalQuantity: 0,
        boxList: []
      };
    }
    
    const data = historySheet.getDataRange().getValues();
    if (data.length <= 1) return { totalBoxes: 0, totalItems: 0, totalQuantity: 0, boxList: [] };
    
    const boxStats = {};
    let totalQuantity = 0;
    
    // 헤더 제외하고 처리
    for (let i = 1; i < data.length; i++) {
      const boxInfo = data[i][1]; // 박스정보
      const quantity = data[i][5]; // 수량
      
      if (!boxStats[boxInfo]) {
        boxStats[boxInfo] = {
          name: boxInfo,
          itemCount: 0,
          totalQuantity: 0,
          firstTime: data[i][0],
          lastTime: data[i][0]
        };
      }
      
      boxStats[boxInfo].itemCount++;
      boxStats[boxInfo].totalQuantity += quantity;
      boxStats[boxInfo].lastTime = data[i][0];
      totalQuantity += quantity;
    }
    
    const boxList = Object.values(boxStats).sort((a, b) => 
      new Date(b.lastTime) - new Date(a.lastTime)
    );
    
    return {
      totalBoxes: boxList.length,
      totalItems: data.length - 1,
      totalQuantity: totalQuantity,
      boxList: boxList
    };
    
  } catch (error) {
    console.error('출고 통계 조회 실패:', error);
    return {
      totalBoxes: 0,
      totalItems: 0,
      totalQuantity: 0,
      boxList: []
    };
  }
}

// 음성 설정 기본값
function getDefaultVoiceSettings() {
  return {
    volume: 0.8,        // 볼륨 (0.0 - 1.0)
    rate: 1.2,          // 속도 (0.5 - 2.0)
    pitch: 1.0,         // 높낮이 (0.0 - 2.0)
    language: 'ko-KR'   // 언어 (ko-KR, ja-JP, en-US)
  };
}

// 음성 설정 저장
function saveVoiceSettings(settings) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    scriptProperties.setProperty('VOICE_SETTINGS', JSON.stringify(settings));
    
    return {
      success: true,
      message: '음성 설정이 저장되었습니다.'
    };
  } catch (error) {
    console.error('음성 설정 저장 실패:', error);
    return {
      success: false,
      message: '저장 중 오류가 발생했습니다.'
    };
  }
}

// 음성 설정 로드
function getVoiceSettings() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const saved = scriptProperties.getProperty('VOICE_SETTINGS');
    
    if (saved) {
      const settings = JSON.parse(saved);
      // 기본값과 병합하여 누락된 속성 보완
      return Object.assign(getDefaultVoiceSettings(), settings);
    }
    
    return getDefaultVoiceSettings();
  } catch (error) {
    console.error('음성 설정 로드 실패:', error);
    return getDefaultVoiceSettings();
  }
}

// 출고 세션 저장/복원
function saveShippingSession(sessionData) {
  try {
    const userProps = PropertiesService.getUserProperties();
    const dataString = JSON.stringify(sessionData);
    const sizeInBytes = Utilities.newBlob(dataString).getBytes().length;
    
    console.log('세션 크기:', sizeInBytes, 'bytes');
    
    // 8KB 이하면 Properties에 저장
    if (sizeInBytes < 8000) {
      userProps.setProperty('shippingSession', dataString);
      userProps.setProperty('shippingSessionLocation', 'properties');
      return { success: true, location: 'properties', size: sizeInBytes };
    }
    
    // 8KB 초과면 스프레드시트에 저장
    console.log('세션이 너무 커서 스프레드시트에 저장합니다');
    const result = saveSessionToSheet(sessionData);
    
    // Properties에는 위치 정보만 저장
    userProps.setProperty('shippingSessionLocation', 'sheet');
    userProps.deleteProperty('shippingSession'); // 기존 데이터 삭제
    
    return { 
      success: result.success, 
      location: 'sheet', 
      size: sizeInBytes 
    };
    
  } catch (error) {
    console.error('세션 저장 실패:', error);
    return { success: false, error: error.toString() };
  }
}

// 스프레드시트에 세션 저장
function saveSessionToSheet(sessionData) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    let sheet = ss.getSheetByName('출고세션백업');
    
    if (!sheet) {
      sheet = ss.insertSheet('출고세션백업');
      // 헤더 설정
      sheet.getRange(1, 1, 1, 5).setValues([[
        '사용자', '발주서ID', '세션데이터', '저장시간', '크기(KB)'
      ]]);
      sheet.setFrozenRows(1);
    }
    
    const userEmail = Session.getActiveUser().getEmail();
    const dataString = JSON.stringify(sessionData);
    const sizeInKB = (Utilities.newBlob(dataString).getBytes().length / 1024).toFixed(2);
    
    // 같은 사용자의 이전 세션 찾기
    const data = sheet.getDataRange().getValues();
    let rowToUpdate = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === userEmail && data[i][1] === sessionData.orderId) {
        rowToUpdate = i + 1;
        break;
      }
    }
    
    const rowData = [
      userEmail,
      sessionData.orderId,
      dataString,
      new Date(),
      sizeInKB
    ];
    
    if (rowToUpdate > 0) {
      // 기존 행 업데이트
      sheet.getRange(rowToUpdate, 1, 1, 5).setValues([rowData]);
    } else {
      // 새 행 추가
      sheet.appendRow(rowData);
    }
    
    return { success: true };
    
  } catch (error) {
    console.error('스프레드시트 저장 실패:', error);
    return { success: false, error: error.toString() };
  }
}

function getShippingSession() {
  try {
    const userProps = PropertiesService.getUserProperties();
    const location = userProps.getProperty('shippingSessionLocation');
    
    console.log('세션 저장 위치:', location);
    
    // Properties에서 먼저 확인
    if (location !== 'sheet') {
      const session = userProps.getProperty('shippingSession');
      if (session) {
        const sessionData = JSON.parse(session);
        const sessionAge = Date.now() - new Date(sessionData.serverTimestamp || sessionData.lastActivity).getTime();
        
        if (sessionAge < 7 * 24 * 60 * 60 * 1000) {
          console.log('Properties에서 세션 로드 성공');
          return sessionData;
        }
      }
    }
    
    // 스프레드시트에서 확인
    if (location === 'sheet') {
      const sessionData = loadSessionFromSheet();
      if (sessionData) {
        console.log('스프레드시트에서 세션 로드 성공');
        return sessionData;
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('세션 로드 실패:', error);
    return null;
  }
}

// 스프레드시트에서 세션 로드
function loadSessionFromSheet() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheet = ss.getSheetByName('출고세션백업');
    
    if (!sheet) return null;
    
    const userEmail = Session.getActiveUser().getEmail();
    const data = sheet.getDataRange().getValues();
    
    // 사용자의 최신 세션 찾기
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === userEmail) {
        const sessionData = JSON.parse(data[i][2]);
        const savedTime = new Date(data[i][3]);
        const sessionAge = Date.now() - savedTime.getTime();
        
        // 7일 이내 세션만
        if (sessionAge < 7 * 24 * 60 * 60 * 1000) {
          return sessionData;
        }
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('스프레드시트 세션 로드 실패:', error);
    return null;
  }
}

function clearShippingSession() {
  try {
    const userProperties = PropertiesService.getUserProperties();
    userProperties.deleteProperty('shippingSession');
    return { success: true };
  } catch (error) {
    console.error('세션 클리어 실패:', error);
    return { success: false };
  }
}

// ===== 패킹리스트 관련 함수들 =====

// 패킹리스트 내보내기
function exportPackingList(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    
    if (!orderSheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.' };
    }
    
    // 패킹리스트 시트 생성 또는 가져오기
    let packingSheet = ss.getSheetByName('패킹리스트');
    if (!packingSheet) {
      packingSheet = ss.insertSheet('패킹리스트');
      
      // 헤더 설정
      const headers = ['바코드', '상품명', '옵션', '수량', '박스번호', '메모', '비고'];
      packingSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      packingSheet.getRange(1, 1, 1, headers.length)
        .setBackground('#f0f0f0')
        .setFontWeight('bold');
      
      // 열 너비 조정
      packingSheet.setColumnWidth(1, 120); // 바코드
      packingSheet.setColumnWidth(2, 200); // 상품명
      packingSheet.setColumnWidth(3, 150); // 옵션
      packingSheet.setColumnWidth(4, 60);  // 수량
      packingSheet.setColumnWidth(5, 80);  // 박스번호
      packingSheet.setColumnWidth(6, 150); // 메모
      packingSheet.setColumnWidth(7, 100); // 비고
    }
    
    // 발주서에서 박스번호가 있는 항목만 가져오기
    const lastRow = orderSheet.getLastRow();
    if (lastRow <= 6) {
      return { success: false, message: '내보낼 데이터가 없습니다.' };
    }
    
    const data = orderSheet.getRange(7, 1, lastRow - 6, 16).getValues();
    const packingItems = [];
    
    for (let i = 0; i < data.length; i++) {
      const boxNumbers = data[i][15]; // P열: 박스번호
      
      if (boxNumbers) {
        const barcode = data[i][0];      // A열
        const name = data[i][1];          // B열
        const option = data[i][2];        // C열
        const comment = data[i][8];       // I열: 코멘트
        const status = data[i][9];        // J열: 상태
        
        // 박스번호 파싱 (예: "1(5), 2(3)")
        const boxMatches = boxNumbers.match(/(\d+)\((\d+)\)/g);
        
        if (boxMatches) {
          boxMatches.forEach(match => {
            const [, boxNum, qty] = match.match(/(\d+)\((\d+)\)/);
            packingItems.push({
              barcode: barcode,
              name: name,
              option: option || '',
              quantity: parseInt(qty),
              boxNumber: parseInt(boxNum),
              memo: comment || '',
              status: status || ''
            });
          });
        }
      }
    }
    
    if (packingItems.length === 0) {
      return { success: false, message: '패킹 완료된 항목이 없습니다.' };
    }
    
    // 박스번호 순으로 정렬
    packingItems.sort((a, b) => a.boxNumber - b.boxNumber);
    
    // 중복 체크를 위한 기존 데이터 가져오기
    const existingLastRow = packingSheet.getLastRow();
    const existingData = existingLastRow > 1 ? 
      packingSheet.getRange(2, 1, existingLastRow - 1, 5).getValues() : [];
    
    // 기존 데이터를 Map으로 변환 (바코드-박스번호 조합이 키)
    const existingMap = new Map();
    existingData.forEach((row, index) => {
      const key = `${row[0]}-${row[4]}`; // 바코드-박스번호
      existingMap.set(key, index + 2); // 행 번호 저장
    });
    
    // 새로운 항목과 업데이트할 항목 분리
    const newItems = [];
    const updateItems = [];
    
    packingItems.forEach(item => {
      const key = `${item.barcode}-${item.boxNumber}`;
      if (existingMap.has(key)) {
        updateItems.push({
          row: existingMap.get(key),
          item: item
        });
      } else {
        newItems.push(item);
      }
    });
    
    // 기존 항목 업데이트
    updateItems.forEach(({ row, item }) => {
      packingSheet.getRange(row, 4).setValue(item.quantity); // 수량만 업데이트
      packingSheet.getRange(row, 6).setValue(item.memo);     // 메모 업데이트
      packingSheet.getRange(row, 7).setValue(item.status);   // 상태 업데이트
    });
    
    // 새 항목 추가
    if (newItems.length > 0) {
      const newData = newItems.map(item => [
        item.barcode,
        item.name,
        item.option,
        item.quantity,
        item.boxNumber,
        item.memo,
        item.status
      ]);
      
      const startRow = packingSheet.getLastRow() + 1;
      packingSheet.getRange(startRow, 1, newData.length, 7).setValues(newData);
    }
    
    // 내보내기 시간 기록
    packingSheet.getRange(1, 9).setValue('최종 업데이트:');
    packingSheet.getRange(1, 10).setValue(new Date());
    
    return {
      success: true,
      message: `패킹리스트가 업데이트되었습니다. (${newItems.length}개 추가, ${updateItems.length}개 업데이트)`,
      sheetUrl: ss.getUrl() + '#gid=' + packingSheet.getSheetId(),
      newCount: newItems.length,
      updateCount: updateItems.length
    };
    
  } catch (error) {
    console.error('패킹리스트 내보내기 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 패킹리스트 자동 업데이트 함수
function updatePackingListAuto(spreadsheet, shippingData, boxNumber) {
  try {
    // 패킹리스트 시트 가져오기 또는 생성
    let packingSheet = spreadsheet.getSheetByName('패킹리스트');
    
    if (!packingSheet) {
      packingSheet = spreadsheet.insertSheet('패킹리스트');
      
      // 헤더 설정
      const headers = ['바코드', '상품명', '옵션', '수량', '박스번호', '메모', '비고', '스캔시간'];
      packingSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      packingSheet.getRange(1, 1, 1, headers.length)
        .setBackground('#f0f0f0')
        .setFontWeight('bold');
      
      // 열 너비 조정
      packingSheet.setColumnWidth(1, 120); // 바코드
      packingSheet.setColumnWidth(2, 200); // 상품명
      packingSheet.setColumnWidth(3, 150); // 옵션
      packingSheet.setColumnWidth(4, 60);  // 수량
      packingSheet.setColumnWidth(5, 80);  // 박스번호
      packingSheet.setColumnWidth(6, 150); // 메모
      packingSheet.setColumnWidth(7, 100); // 비고
      packingSheet.setColumnWidth(8, 150); // 스캔시간
    }
    
    // 패킹 데이터 생성
    const timestamp = new Date();
    const packingData = shippingData.items.map(item => [
      item.barcode,
      item.name,
      item.option || '',
      item.scannedInThisBox,
      boxNumber,
      item.comment || '',
      item.stockAvailable || '',
      timestamp
    ]);
    
    if (packingData.length > 0) {
      // 중복 체크를 위한 기존 데이터 가져오기
      const lastRow = packingSheet.getLastRow();
      const existingData = lastRow > 1 ? 
        packingSheet.getRange(2, 1, lastRow - 1, 5).getValues() : [];
      
      // 기존 데이터를 Map으로 변환
      const existingMap = new Map();
      existingData.forEach((row, index) => {
        const key = `${row[0]}-${row[4]}`; // 바코드-박스번호
        existingMap.set(key, index + 2);
      });
      
      // 새로운 항목과 업데이트할 항목 분리
      const newItems = [];
      const updateRows = [];
      
      packingData.forEach(rowData => {
        const key = `${rowData[0]}-${rowData[4]}`; // 바코드-박스번호
        if (existingMap.has(key)) {
          // 기존 항목 업데이트
          const rowIndex = existingMap.get(key);
          updateRows.push({ rowIndex, data: rowData });
        } else {
          // 새 항목
          newItems.push(rowData);
        }
      });
      
      // 기존 항목 업데이트
      updateRows.forEach(({ rowIndex, data }) => {
        packingSheet.getRange(rowIndex, 1, 1, 8).setValues([data]);
      });
      
      // 새 항목 추가
      if (newItems.length > 0) {
        const startRow = packingSheet.getLastRow() + 1;
        packingSheet.getRange(startRow, 1, newItems.length, 8).setValues(newItems);
      }
    }
    
    console.log('패킹리스트 자동 업데이트 완료');
    
  } catch (error) {
    console.error('패킹리스트 자동 업데이트 실패:', error);
    // 에러가 발생해도 출고 프로세스는 계속 진행
  }
}

// 패킹리스트 CSV 다운로드
function downloadPackingListCSV(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const packingSheet = ss.getSheetByName('패킹리스트');
    
    if (!packingSheet) {
      return { success: false, message: '패킹리스트가 없습니다.' };
    }
    
    const lastRow = packingSheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, message: '다운로드할 데이터가 없습니다.' };
    }
    
    const data = packingSheet.getRange(1, 1, lastRow, 7).getValues();
    
    // CSV 생성
    let csv = '\ufeff'; // BOM 추가 (한글 인코딩)
    data.forEach(row => {
      const csvRow = row.map(cell => {
        const cellStr = String(cell);
        // 쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 감싸기
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return '"' + cellStr.replace(/"/g, '""') + '"';
        }
        return cellStr;
      }).join(',');
      csv += csvRow + '\n';
    });
    
    const today = new Date();
    const dateStr = Utilities.formatDate(today, 'GMT+9', 'yyyyMMdd');
    const filename = `패킹리스트_${dateStr}.csv`;
    
    return {
      success: true,
      csvContent: csv,
      filename: filename
    };
    
  } catch (error) {
    console.error('CSV 다운로드 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// getPackingListUrl 함수 추가 (Code.gs의 패킹리스트 관련 함수들 섹션에 추가)
function getPackingListUrl(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const packingSheet = ss.getSheetByName('패킹리스트');
    
    if (packingSheet) {
      return {
        success: true,
        sheetUrl: ss.getUrl() + '#gid=' + packingSheet.getSheetId()
      };
    }
    
    return { 
      success: false,
      sheetUrl: null,
      message: '패킹리스트 시트가 없습니다. 먼저 내보내기를 실행해주세요.'
    };
  } catch (error) {
    console.error('패킹리스트 URL 가져오기 실패:', error);
    return { 
      success: false,
      sheetUrl: null,
      message: error.toString()
    };
  }
}

// 모든 박스번호 초기화 (발주서의 모든 출고 기록 초기화)
function resetAllBoxNumbers(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    
    if (!orderSheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.' };
    }
    
    // P열(박스번호) 초기화
    const lastRow = orderSheet.getLastRow();
    if (lastRow > 6) {
      const numRows = lastRow - 6;
      const clearRange = orderSheet.getRange(7, 16, numRows, 1); // P열
      clearRange.clearContent();
    }
    
    // 출고이력 시트 삭제
    const historySheet = ss.getSheetByName('출고이력');
    if (historySheet) {
      ss.deleteSheet(historySheet);
    }
    
    // 패킹리스트 시트 삭제
    const packingSheet = ss.getSheetByName('패킹리스트');
    if (packingSheet) {
      ss.deleteSheet(packingSheet);
    }
    
    // 박스번호 초기화
    const scriptProperties = PropertiesService.getScriptProperties();
    const key = `boxNumber_${orderId}`;
    scriptProperties.deleteProperty(key);
    
    // 세션 삭제
    const userProperties = PropertiesService.getUserProperties();
    userProperties.deleteProperty('shippingSession');
    userProperties.deleteProperty('shippingSessionLocation');
    
    return {
      success: true,
      message: '모든 출고 기록이 초기화되었습니다.'
    };
    
  } catch (error) {
    console.error('박스번호 초기화 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

/**
 * 웹앱에서 Smaregi 재고 데이터 가져오기
 * @returns {Object} 재고 데이터
 */
function getSmaregiData() {
  try {
    console.log('=== getSmaregiData 호출 ===');
    
    // Smaregi API 사용 가능 확인
    if (!isSmaregiAvailable()) {
      console.log('Smaregi API 사용 불가');
      return {
        data: {},
        uploadTime: null,
        success: false
      };
    }
    
    // 재고 데이터 가져오기
    const stockResult = getSmaregiStockData();
    
    if (stockResult.success && stockResult.data) {
      console.log(`Smaregi 재고 데이터: ${Object.keys(stockResult.data).length}개`);
      
      // 바코드를 키로 하는 객체로 변환
      const stockMap = {};
      Object.entries(stockResult.data).forEach(([barcode, info]) => {
        // 재고 수량만 저장 (메모리 절약)
        stockMap[barcode] = info.quantity || 0;
      });
      
      return {
        data: stockMap,
        uploadTime: stockResult.timestamp || new Date().toISOString(),
        success: true
      };
    }
    
    return {
      data: {},
      uploadTime: null,
      success: false
    };
    
  } catch (error) {
    console.error('getSmaregiData 오류:', error);
    return {
      data: {},
      uploadTime: null,
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Smaregi API 사용 가능 여부 확인
 * @returns {boolean} 사용 가능 여부
 */
function isSmaregiAvailable() {
  try {
    // Platform API 설정 확인
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      return !!(config.CLIENT_ID && config.CLIENT_SECRET);
    }
    
    // Legacy API 설정 확인 (있다면)
    const userProps = PropertiesService.getUserProperties();
    const apiKey = userProps.getProperty('SMAREGI_API_KEY');
    
    return !!apiKey;
    
  } catch (error) {
    console.error('Smaregi 사용 가능 여부 확인 실패:', error);
    return false;
  }
}

/**
 * 개별 상품의 판매 데이터 조회 (웹앱에서 사용)
 * @param {string} barcode - 상품 바코드
 * @returns {Object} 판매 데이터
 */
function getProductSalesData(barcode) {
  try {
    if (!barcode) {
      return {
        success: false,
        message: '바코드가 없습니다'
      };
    }
    
    // API 연결 확인
    if (!isSmaregiAvailable()) {
      return {
        success: false,
        message: 'Smaregi API가 연결되지 않았습니다'
      };
    }
    
    // 설정에서 기간 가져오기
    const settings = getSettings();
    const shortPeriod = parseInt(settings.salesPeriodShort) || 7;
    const longPeriod = parseInt(settings.salesPeriodLong) || 30;
    
    console.log(`판매 데이터 조회 - 바코드: ${barcode}, 단기: ${shortPeriod}일, 장기: ${longPeriod}일`);
    
    // 장기 판매 데이터 조회
    const endDate = new Date();
    const longStartDate = new Date();
    longStartDate.setDate(longStartDate.getDate() - longPeriod);
    
    // 단기 판매 데이터 조회
    const shortStartDate = new Date();
    shortStartDate.setDate(shortStartDate.getDate() - shortPeriod);
    
    // API에서 판매 데이터 가져오기
    const longSalesResult = getBatchSalesData([barcode], longPeriod);
    const shortSalesResult = getBatchSalesData([barcode], shortPeriod);
    
    const longSales = longSalesResult && longSalesResult.length > 0 ? longSalesResult[0] : null;
    const shortSales = shortSalesResult && shortSalesResult.length > 0 ? shortSalesResult[0] : null;
    
    // 판매 추세 계산
    let trend = 'stable';
    if (longSales && shortSales) {
      const avgLong = longSales.quantity / longPeriod;
      const avgShort = shortSales.quantity / shortPeriod;
      
      if (avgShort > avgLong * 1.2) {
        trend = 'up';
      } else if (avgShort < avgLong * 0.8) {
        trend = 'down';
      }
    }
    
    const result = {
      success: true,
      salesInfo: {
        barcode: barcode,
        lastShortDays: shortSales ? shortSales.quantity : 0,
        lastLongDays: longSales ? longSales.quantity : 0,
        dailyAverage: longSales ? parseFloat((longSales.quantity / longPeriod).toFixed(1)) : 0,
        trend: trend,
        shortPeriod: shortPeriod,
        longPeriod: longPeriod,
        amount: longSales ? longSales.amount : 0
      }
    };
    
    console.log(`${barcode} 판매 데이터:`, result.salesInfo);
    
    return result;
    
  } catch (error) {
    console.error('판매 데이터 조회 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// ===== Code.gs에 추가할 함수들 =====

/**
 * 여러 바코드로 상품 조회 (프리페치용)
 */
function getProductsByBarcodes(barcodes) {
  if (!barcodes || barcodes.length === 0) return [];
  
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('상품 데이터베이스');
    if (!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const barcodeIndex = headers.indexOf('バーコード');
    
    if (barcodeIndex === -1) return [];
    
    const products = [];
    const barcodeSet = new Set(barcodes);
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const barcode = String(row[barcodeIndex]);
      
      if (barcodeSet.has(barcode)) {
        const product = {};
        headers.forEach((header, index) => {
          product[header] = row[index];
        });
        products.push(product);
        
        // 찾은 바코드는 제거 (중복 방지)
        barcodeSet.delete(barcode);
        
        // 모두 찾았으면 종료
        if (barcodeSet.size === 0) break;
      }
    }
    
    return products;
    
  } catch (error) {
    console.error('상품 일괄 조회 실패:', error);
    return [];
  }
}

/**
 * 초기 데이터 번들 (최적화)
 */
function getInitialDataBundle() {
  const startTime = new Date().getTime();
  
  try {
    // 캐시 확인
    const cached = getCache('INITIAL_BUNDLE');
    if (cached) {
      console.log('번들 캐시 사용');
      return cached;
    }
    
    console.log('초기 데이터 번들 생성 시작');
    
    const bundle = {
      timestamp: new Date().toISOString(),
      settings: getSettings(),
      translations: loadTranslations((getSettings().language || 'japanese')),
      currentOrder: checkCurrentOrder(),
      categoryRules: getCachedCategoryRules(),
      smaregiData: null,
      products: null
    };
    
    // 상품 데이터 로드
    const productsData = loadInitialProductsWithIssues();
    bundle.products = {
      data: productsData.products,
      withIssues: productsData.withIssues,
      totalCount: productsData.totalCount
    };
    
    // Smaregi 데이터
    const smaregiData = getSmaregiData();
    if (smaregiData) {
      bundle.smaregiData = {
        data: smaregiData,
        uploadTime: PropertiesService.getScriptProperties().getProperty('smaregiUploadTime')
      };
    }
    
    // 발주서가 있으면 발주 항목도 포함
    if (bundle.currentOrder) {
      bundle.orderItems = loadOrderItemsFromSheet(bundle.currentOrder.sheetName);
    }
    
    // 캐시 저장 (10분)
    setCache('INITIAL_BUNDLE', bundle, 600);
    
    const loadTime = new Date().getTime() - startTime;
    console.log(`번들 생성 완료: ${loadTime}ms`);
    
    return bundle;
    
  } catch (error) {
    console.error('번들 생성 실패:', error);
    // 실패시 개별 로드로 폴백
    return null;
  }
}

/**
 * 카테고리 규칙 캐시 버전
 */
function getCachedCategoryRules() {
  const cached = getCache(CACHE_KEYS.CATEGORY_RULES);
  if (cached) return cached;
  
  const rules = loadCategoryRules();
  setCache(CACHE_KEYS.CATEGORY_RULES, rules, CACHE_DURATION.LONG);
  return rules;
}

// 초기 로드 데이터 병렬 처리
function getInitialLoadData() {
  try {
    console.log('=== 초기 데이터 병렬 로드 시작 ===');
    
    // 병렬로 데이터 로드
    const promises = [
      // 상품 데이터
      (() => {
        try {
          return {
            type: 'products',
            data: loadInitialProductsWithIssues()
          };
        } catch (e) {
          console.error('상품 로드 실패:', e);
          return { type: 'products', data: null, error: e.toString() };
        }
      })(),
      
      // 재고 데이터
      (() => {
        try {
          return {
            type: 'stock',
            data: getSmaregiStockData()
          };
        } catch (e) {
          console.error('재고 로드 실패:', e);
          return { type: 'stock', data: null, error: e.toString() };
        }
      })(),
      
      // 판매 데이터 (첫 50개만)
      (() => {
        try {
          const salesData = {};
          const products = getFrequentProducts(50);
          
          products.forEach(product => {
            const sales = getCachedSalesData(product.barcode);
            if (sales) {
              salesData[product.barcode] = sales;
            }
          });
          
          return {
            type: 'sales',
            data: { success: true, data: salesData }
          };
        } catch (e) {
          console.error('판매 로드 실패:', e);
          return { type: 'sales', data: null, error: e.toString() };
        }
      })()
    ];
    
    // 결과 정리
    const result = {
      products: null,
      stock: null,
      sales: null
    };
    
    promises.forEach(item => {
      result[item.type] = item.data;
    });
    
    console.log('=== 초기 데이터 로드 완료 ===');
    return result;
    
  } catch (error) {
    console.error('초기 데이터 로드 실패:', error);
    throw error;
  }
}

// ===== Code.gs에 추가할 함수 =====

/**
 * 전체 상품의 판매 데이터 로드 (웹앱용)
 * @returns {Object} 전체 판매 데이터
 */
function loadAllProductsSalesData() {
  try {
    // API 연결 확인
    if (!isSmaregiAvailable()) {
      return {
        success: false,
        data: {},
        message: 'Smaregi API가 연결되지 않았습니다'
      };
    }
    
    // 설정에서 기간 가져오기
    const settings = getSettings();
    const longPeriod = Math.min(parseInt(settings.salesPeriodLong) || 30, 31); // 최대 31일
    
    console.log(`전체 판매 데이터 로드 (${longPeriod}일)`);
    
    // 캐시 확인
    const cacheKey = `ALL_SALES_DATA_V2_${longPeriod}`;
    const cached = getCache(cacheKey);
    
    if (cached && cached.timestamp) {
      const cacheAge = (new Date() - new Date(cached.timestamp)) / 1000 / 60; // 분
      if (cacheAge < 120) { // 2시간 이내
        console.log('캐시된 전체 판매 데이터 사용');
        return {
          success: true,
          data: cached.data,
          timestamp: cached.timestamp,
          cached: true
        };
      }
    }
    
    // 판매 데이터 조회
    const salesResult = getSimpleSalesDataV2(longPeriod);
    
    if (!salesResult || !salesResult.success) {
      console.error('판매 데이터 조회 실패');
      return {
        success: false,
        data: {},
        message: '판매 데이터 조회 실패'
      };
    }
    
    // 바코드를 키로 하는 맵으로 변환
    // (getSimpleSalesDataV2는 productCode를 키로 반환하는데, 우리 시스템에서는 바코드가 productCode와 동일)
    const salesByBarcode = {};
    
    Object.entries(salesResult.data || {}).forEach(([productCode, salesData]) => {
      // productCode를 바코드로 사용
      salesByBarcode[productCode] = {
        barcode: productCode,
        quantity: salesData.quantity || 0,
        avgDaily: parseFloat(((salesData.quantity || 0) / longPeriod).toFixed(1)),
        amount: salesData.amount || 0,
        transactions: salesData.transactions || 0,
        productName: salesData.productName || '',
        trend: 'stable' // 추세는 별도 계산 필요시 추가
      };
    });
    
    console.log(`${Object.keys(salesByBarcode).length}개 상품의 판매 데이터 수집`);
    
    // 결과 캐싱
    const cacheData = {
      data: salesByBarcode,
      timestamp: new Date().toISOString()
    };
    
    setCache(cacheKey, cacheData, 7200); // 2시간 캐시
    
    return {
      success: true,
      data: salesByBarcode,
      timestamp: cacheData.timestamp,
      cached: false
    };
    
  } catch (error) {
    console.error('전체 판매 데이터 로드 실패:', error);
    return {
      success: false,
      data: {},
      error: error.toString()
    };
  }
}
