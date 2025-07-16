// ===== 전역 설정 Code.gs ===== 

const CONFIG = {
    // 스프레드시트 ID
    PRODUCT_SHEET_ID: '1fhU41XoZQyu0QlVgwQe3zIbWg-CdULl7UMNeLYQLS5E',
    ORDER_SHEET_ID: '1eTIFbWZupx4BhX-PUmgXBNCx-l0BEsLG7GinlCGTNSA',
    PRODUCT_SHEET_NAME: '상품목록',
    CATEGORY_SHEET_NAME: 'category',
    SEARCH_INDEX_NAME: '검색인덱스',
    
    // 발주서 열 정의
    ORDER_SHEET_COLUMNS: 19, // A~S열까지 (P:박스번호, Q:출고가능수량, R:출고상태, S:출고완료시간)

    // 검색 및 캐시 설정
    MAX_SEARCH_RESULTS: 100,
    CACHE_DURATION: 3600, // 1시간
    FREQUENT_ITEMS_COUNT: 1000,

    // 발주 설정
    DEFAULT_MONTHLY_BUDGET: 10000000,
    LOW_STOCK_THRESHOLD: 10,

    // Smaregi API 설정 (Phase 2에서 사용 예정)
    SMAREGI: {
        CONTRACT_ID: 'skuv592u8',
        ACCESS_TOKEN: '78a128116eda101dac5eeb3bb0546c28',
        API_BASE_URL: 'https://webapi.smaregi.jp/access/',
        TIMEOUT: 30000
    },

    // Smaregi プラットフォームAPI 설정
    PLATFORM_CONFIG: {
        // 개발환경용 계약ID
        DEV_CONTRACT_ID: 'sb_skx951h6',

        // 본번환경용 계약ID
        PROD_CONTRACT_ID: 'skuv592u8',

        // 開発環境
        DEV_CLIENT_ID: '5436f7f654c4efa5d2a1f56355c5bca1',
        DEV_CLIENT_SECRET: '531546d78dc35216c63531cf66c85f04ecc472f31ef70d3ea85ce7ae3c1c0724',

        // 本番環境
        PROD_CLIENT_ID: 'add65344a30e3d0b0893fe972702a7b4',
        PROD_CLIENT_SECRET: 'e0ba58828a61ec832facf93bb8c6b40d80085c56f6c191b83a496c2cc97b61cd', // ← 설정 완료!

        // 환경 선택 - 본번환경으로 변경
        USE_PRODUCTION: true, // ← 본번환경으로 변경

        // API 엔드포인트
        DEV_TOKEN_URL: 'https://id.smaregi.dev/app/',
        PROD_TOKEN_URL: 'https://id.smaregi.jp/app/',
        DEV_API_BASE_URL: 'https://api.smaregi.dev/',
        PROD_API_BASE_URL: 'https://api.smaregi.jp/',

        // 권한 스코프
        SCOPES: 'pos.stores:read pos.products:read pos.stock-changes:read pos.stock:read pos.transactions:read'
    }
};

// ===== 메뉴 추가 =====
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('데이터 관리')
      .addItem('데이터 복구 도구', 'showDataRecoveryDialog')
      .addItem('즉시 동기화', 'autoSyncData')
      .addItem('검증 보고서', 'dailyDataValidation')
      .addSeparator()
      .addItem('동기화 트리거 설정', 'setupDataConsistencyTriggers')
      .addToUi();
      
    // Smaregi 실시간 동기화 메뉴 추가
    ui.createMenu('Smaregi 실시간')
      .addItem('✅ 실시간 동기화 시작 (5분마다)', 'setupRealtimeSyncTriggers')
      .addItem('🔄 수동 동기화 실행', 'manualSyncSales')
      .addItem('📊 동기화 상태 확인', 'checkSyncStatus')
      .addSeparator()
      .addItem('🛠️ 연결 테스트', 'testSmaregiConnection')
      .addItem('⚡ 성능 측정', 'checkSyncPerformance')
      .addToUi();
    
    // Smaregi 메뉴 추가
    if (typeof addArchiveMenu === 'function') {
      addArchiveMenu();
    }
  } catch (e) {
    // 웹앱에서는 메뉴를 추가할 수 없으므로 에러 무시
    console.log('메뉴 추가 스킵 (웹앱 모드)');
  }
}

// ===== 웹앱 진입점 =====
function doGet(e) {
  // 디버그 페이지 요청 확인
  if (e && e.parameter && e.parameter.page === 'debug') {
    const debugTemplate = HtmlService.createTemplateFromFile('debugClient');
    return debugTemplate
      .evaluate()
      .setTitle('SmaregiData 디버그')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  // 기존 index 페이지
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

// 전체 SmaregiData 가져오기 (전체 캐싱) - 웹앱에서 직접 호출 가능
function getFullSmaregiData() {
  try {
    console.log('getFullSmaregiData 시작');
    
    // 명시적으로 빈 객체를 먼저 생성
    let result = {};
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    
    // Try multiple data sources in order of preference
    
    // 1. First try Properties Service (fastest)
    // 일시적으로 Properties Service 캐시를 건너뛰고 시트에서 직접 로드
    const skipCache = true; // 캐시 문제 해결 후 false로 변경
    
    if (!skipCache) {
      try {
        const summaryData = getSmaregiSummaryForWebApp();
        if (summaryData && summaryData.data && Object.keys(summaryData.data).length > 0) {
          console.log('SmaregiData loaded from Properties Service:', Object.keys(summaryData.data).length, '개');
          
          // Convert to expected format
          const allProducts = {};
          Object.entries(summaryData.data).forEach(([productId, data]) => {
            allProducts[productId] = {
              stock: data.stock || 0,
              sales30: data.sales30 || 0,
              sales365: 0, // Not available in summary
              avgDaily: data.dailyAvg || 0,
              lastSale: summaryData.lastUpdate || ''
            };
          });
          
          return allProducts;
        }
      } catch (e) {
        console.log('Properties Service 조회 실패, 시트에서 로드 시도...');
      }
    }
    
    // 2. Try SmaregiData sheet (original)
    const sheet = ss.getSheetByName('SmaregiData');
    console.log('SmaregiData 시트 확인:', sheet ? '존재' : '없음', sheet ? `행수: ${sheet.getLastRow()}` : '');
    
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      console.log(`SmaregiData 시트 행 수: ${data.length}`);
      
      const allProducts = {};
      let withSalesCount = 0;
      
      // 헤더 제외하고 모든 데이터 처리
      // SmaregiData 열 구조: A:상품ID, B:상품명, C:현재재고, D:30일판매량, E:1년판매량, F:일평균판매량, G:재고회전일수, H:인기순위, I:업데이트시간
      for (let i = 1; i < data.length; i++) {
        const barcode = String(data[i][0]).trim(); // A열: 상품ID
        
        // 바코드가 비어있으면 건너뛰기
        if (!barcode || barcode === 'undefined' || barcode === 'null') {
          continue;
        }
        
        const recent30Days = parseInt(data[i][3]) || 0; // D열: 30일 판매량
        
        allProducts[barcode] = {
          stock: parseInt(data[i][2]) || 0,     // C열: 현재재고
          sales30: recent30Days,                // D열: 30일 판매량
          sales365: parseInt(data[i][4]) || 0,  // E열: 1년 판매량
          avgDaily: parseFloat(data[i][5]) || 0, // F열: 일평균판매량
          lastSale: data[i][8] || ''            // I열: 업데이트시간
        };
        
        if (recent30Days > 0) withSalesCount++;
      }
      
      console.log(`SmaregiData 로드 완료: 총 ${Object.keys(allProducts).length}개 (판매 있음: ${withSalesCount}개)`);
      result = allProducts;
      return result;
    }
    
    // 3. Try Smaregi30Days sheet (new structure)
    const smaregi30Days = ss.getSheetByName('Smaregi30Days');
    console.log('Smaregi30Days 시트 확인:', smaregi30Days ? '존재' : '없음', smaregi30Days ? `행수: ${smaregi30Days.getLastRow()}` : '');
    
    if (smaregi30Days && smaregi30Days.getLastRow() > 1) {
      console.log('SmaregiData 시트가 없어 Smaregi30Days 시트 사용');
      const data = smaregi30Days.getDataRange().getValues();
      console.log(`Smaregi30Days 시트 행 수: ${data.length}`);
      
      const allProducts = {};
      let withSalesCount = 0;
      
      // Headers: 상품ID, 상품명, 현재재고, 30일판매량, 일평균판매량, 재고회전일수, 업데이트시간
      for (let i = 1; i < data.length; i++) {
        const barcode = String(data[i][0]).trim(); // A열: 상품ID
        
        // 바코드가 비어있으면 건너뛰기
        if (!barcode || barcode === 'undefined' || barcode === 'null') {
          continue;
        }
        
        const recent30Days = parseInt(data[i][3]) || 0; // D열: 30일 판매량
        
        allProducts[barcode] = {
          stock: parseInt(data[i][2]) || 0,     // C열: 현재재고
          sales30: recent30Days,                // D열: 30일 판매량
          sales365: 0,                          // 1년 판매량 없음
          avgDaily: parseFloat(data[i][4]) || 0, // E열: 일평균판매량
          lastSale: data[i][6] || ''            // G열: 업데이트시간
        };
        
        if (recent30Days > 0) withSalesCount++;
      }
      
      console.log(`Smaregi30Days 로드 완료: 총 ${Object.keys(allProducts).length}개 (판매 있음: ${withSalesCount}개)`);
      result = allProducts;
      return result;
    }
    
    console.log('SmaregiData 소스를 찾을 수 없습니다.');
    return result; // 빈 객체 반환
    
  } catch (error) {
    console.error('getAllSmaregiData 오류:', error.toString());
    console.error('오류 스택:', error.stack);
    return result; // 에러 시에도 빈 객체 반환
  }
}

// 디버그용 테스트 함수
// 백그라운드 로드용 래퍼 함수 - SmaregiDataService 사용
function getAllSmaregiData() {
  console.log('getAllSmaregiData 호출됨 - SmaregiDataService 방식');
  
  try {
    // SmaregiDataService를 사용해서 인기 상품 1000개 가져오기
    const topProducts = SmaregiDataService.getTopProducts(1000);
    
    if (!topProducts || topProducts.length === 0) {
      console.log('SmaregiDataService.getTopProducts가 빈 배열 반환');
      return {};
    }
    
    // 배열을 객체로 변환
    const dataObject = {};
    topProducts.forEach(product => {
      dataObject[product.productId] = {
        stock: product.stock || 0,
        sales30: product.sales30 || 0,
        sales365: product.sales365 || 0,
        avgDaily: product.avgDaily || 0,
        lastSale: ""
      };
    });
    
    console.log(`SmaregiDataService로 ${Object.keys(dataObject).length}개 상품 반환`);
    return dataObject;
    
  } catch (error) {
    console.error('getAllSmaregiData 오류:', error.toString());
    // 에러 발생 시 getFullSmaregiData 시도
    try {
      console.log('폴백: getFullSmaregiData 시도');
      const fallbackData = getFullSmaregiData();
      return fallbackData || {};
    } catch (fallbackError) {
      console.error('폴백도 실패:', fallbackError.toString());
      return {};
    }
  }
}

// 웹앱용 getSmaregiData 함수 - 인기 상품만 초기 로드
function getSmaregiData() {
  try {
    console.log('getSmaregiData 호출됨 - 효율적 로딩 모드');
    
    // 인기 상품 600개 로드 (판매량 있는 것들)
    const topProducts = SmaregiDataService.getTopProducts(600);
    
    // 객체 형태로 변환
    const dataObject = {};
    topProducts.forEach(product => {
      dataObject[product.productId] = {
        stock: product.stock,
        sales30: product.sales30,
        sales365: product.sales365 || 0,
        avgDaily: product.avgDaily,
        lastSale: ''
      };
    });
    
    console.log(`인기 상품 ${Object.keys(dataObject).length}개 반환`);
    return dataObject;
    
  } catch (error) {
    console.error('getSmaregiData 오류:', error);
    return {};
  }
}

// 개별 상품 조회는 이제 불필요 (전체 캐싱하므로)

// Smaregi 데이터 조회 (웹앱용)
function getSmaregiDataForProduct(productId) {
  try {
    const smaregiSummary = getSmaregiSummaryForWebApp();
    
    if (!smaregiSummary.data || !smaregiSummary.data[productId]) {
      return null;
    }
    
    return {
      ...smaregiSummary.data[productId],
      lastUpdate: smaregiSummary.lastUpdate
    };
  } catch (error) {
    console.error('Smaregi 데이터 조회 오류:', error);
    return null;
  }
}

// 여러 상품의 Smaregi 데이터 일괄 조회
function getSmaregiDataBatch(productIds) {
  try {
    const smaregiSummary = getSmaregiSummaryForWebApp();
    
    if (!smaregiSummary.data) {
      return {};
    }
    
    const result = {};
    productIds.forEach(id => {
      if (smaregiSummary.data[id]) {
        result[id] = smaregiSummary.data[id];
      }
    });
    
    return {
      data: result,
      lastUpdate: smaregiSummary.lastUpdate
    };
  } catch (error) {
    console.error('Smaregi 일괄 조회 오류:', error);
    return {};
  }
}

// Code.gs - 상품 데이터 압축 (Smaregi 데이터 포함)
function compressProductData(products) {
  // Smaregi 데이터 일괄 조회
  const productIds = products.map(p => p.barcode);
  const smaregiData = getSmaregiDataBatch(productIds);
  
  return products.map(p => ({
    b: p.barcode,
    n: p.name,
    o: p.option,
    p: p.purchasePrice,
    s: p.supplierName,
    // Smaregi 데이터 추가
    sm: smaregiData.data[p.barcode] || null,
    w: p.weight,
    f: p.isFrequent,
    r: p.isRecent
  }));
}

// ===== HTML 파일 인클루드 =====
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ===== 테스트 함수 =====
// ===== 디버그용 함수 =====
function debugGetExportedItems() {
  console.log('=== debugGetExportedItems 시작 ===');
  
  try {
    // 1. 현재 발주서 확인
    const currentOrder = getCurrentOrder();
    console.log('currentOrder:', currentOrder);
    
    if (!currentOrder) {
      return {
        success: false,
        message: '현재 발주서가 없습니다',
        debugInfo: {
          currentOrder: null,
          userProperties: PropertiesService.getUserProperties().getProperties()
        }
      };
    }
    
    // 2. 실제 getExportedItems 호출
    const result = getExportedItems(currentOrder.orderId);
    console.log('getExportedItems 결과:', result);
    
    return {
      ...result,
      debugInfo: {
        currentOrder: currentOrder,
        orderId: currentOrder.orderId
      }
    };
    
  } catch (error) {
    console.error('debugGetExportedItems 에러:', error);
    return {
      success: false,
      message: error.toString(),
      stack: error.stack,
      debugInfo: {
        error: true
      }
    };
  }
}

// ===== 초기 데이터 로드 (캐시 크기 문제 해결) =====
function loadInitialProductsWithIssues() {
  try {
    const startTime = new Date();
    console.log('loadInitialProductsWithIssues 시작');
    
    // cacheManager의 getCache 사용
    const cachedData = getCache(CACHE_KEYS.INITIAL_PRODUCTS);
    
    if (cachedData && cachedData.timestamp) {
      const age = (new Date() - new Date(cachedData.timestamp)) / 1000 / 60;
      if (age < 30) {
        console.log('캐시에서 데이터 로드');
        const loadTime = new Date() - startTime;
        console.log(`캐시 로드 완료: ${loadTime}ms`);
        return {
          products: cachedData.products || [],
          productIssues: cachedData.productIssues || {},
          cached: true,
          loadTime: loadTime
        };
      }
    }
    
    // 타임아웃 설정 (25초로 증가)
    const maxExecutionTime = 25000;
    const timeoutTime = startTime.getTime() + maxExecutionTime;
    
    // 병렬로 데이터 수집
    let frequentBarcodes = [];
    let recentProducts = [];
    let sharedRecent = [];
    let productIssues = {};
    let smaregiTopProducts = [];
    
    // 1. 자주 발주 바코드 (상위 150개만으로 줄임 - 성능 개선)
    try {
      console.log('자주 발주 바코드 로드 시작');
      frequentBarcodes = getCachedFrequentBarcodes().slice(0, 150);
      console.log(`자주 발주 바코드 ${frequentBarcodes.length}개 로드 완료`);
      
      if (new Date().getTime() > timeoutTime) {
        throw new Error('타임아웃: 자주 발주 바코드 로드');
      }
    } catch (e) {
      console.error('자주 발주 바코드 로드 실패:', e);
      frequentBarcodes = [];
    }
    
    // 1-1. SmaregiData 인기 상품 추가 (재고/판매 데이터 있는 상품)
    // 병렬로 처리하기 위해 여기서는 로드하지 않음
    
    // 2. 최근 추가 상품 (100개로 줄임 - 성능 개선)
    try {
      console.log('최근 추가 상품 로드 시작');
      recentProducts = getRecentProducts(100);
      console.log(`최근 추가 상품 ${recentProducts.length}개 로드 완료`);
      
      if (new Date().getTime() > timeoutTime) {
        throw new Error('타임아웃: 최근 추가 상품 로드');
      }
    } catch (e) {
      console.error('최근 추가 상품 로드 실패:', e);
      recentProducts = [];
    }
    
    // 3. 공유 최근 상품 (50개로 줄임 - 성능 개선)
    try {
      console.log('공유 최근 상품 로드 시작');
      sharedRecent = getSharedRecentProducts().slice(0, 50);
      console.log(`공유 최근 상품 ${sharedRecent.length}개 로드 완료`);
      
      if (new Date().getTime() > timeoutTime) {
        throw new Error('타임아웃: 공유 최근 상품 로드');
      }
    } catch (e) {
      console.error('공유 최근 상품 로드 실패:', e);
      sharedRecent = [];
    }
    
    // 4. 제품 이슈사항
    try {
      console.log('제품 이슈사항 로드 시작');
      productIssues = loadProductIssues();
      console.log(`제품 이슈사항 ${Object.keys(productIssues).length}개 로드 완료`);
    } catch (e) {
      console.error('제품 이슈사항 로드 실패:', e);
      productIssues = {};
    }
    
    // 중복 제거 및 병합
    const productMap = new Map();
    
    // 우선순위대로 추가
    sharedRecent.forEach(p => {
      if (p && p.barcode) {
        p.isSharedRecent = true;
        p.priority = 1;
        productMap.set(p.barcode, p);
      }
    });
    
    // 한 번만 시트 데이터를 읽어서 모든 상품 정보 가져오기
    const dataLoadStart = new Date();
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    const allProductData = sheet.getDataRange().getValues();
    console.log(`시트 데이터 로드: ${new Date() - dataLoadStart}ms, 행수: ${allProductData.length}`);
    
    // 바코드로 인덱싱된 맵 생성
    const indexStart = new Date();
    const productDataMap = new Map();
    for (let i = 1; i < allProductData.length; i++) {
      const barcode = String(allProductData[i][0]);
      productDataMap.set(barcode, {
        barcode: barcode,
        name: allProductData[i][1] || '',
        option: allProductData[i][2] || '',
        weight: allProductData[i][3] || '',
        supplierName: allProductData[i][4] || '',
        purchasePrice: parseFloat(allProductData[i][8]) || 0,
        memo: allProductData[i][9] || '',
        remarks: allProductData[i][10] || ''
      });
    }
    console.log(`인덱싱 완료: ${new Date() - indexStart}ms`);
    
    // 자주 발주 상품 정보 가져오기
    if (frequentBarcodes.length > 0) {
      frequentBarcodes.forEach(barcode => {
        const productData = productDataMap.get(barcode);
        if (productData) {
          if (!productMap.has(barcode)) {
            productMap.set(barcode, productData);
          }
          const existing = productMap.get(barcode);
          existing.isFrequent = true;
          existing.priority = Math.min(existing.priority || 999, 2);
        }
      });
    }
    
    // 최근 추가 상품 (이미 로드된 productDataMap 사용)
    recentProducts.forEach(p => {
      if (p && p.barcode) {
        const productData = productDataMap.get(p.barcode);
        if (productData) {
          if (!productMap.has(p.barcode)) {
            productMap.set(p.barcode, productData);
          }
          const existing = productMap.get(p.barcode);
          existing.isRecent = p.isRecent;
        }
      }
    });
    
    // SmaregiData 인기 상품은 클라이언트에서 처리하도록 변경
    
    // 이슈 정보 병합
    productMap.forEach((product, barcode) => {
      if (productIssues[barcode]) {
        product.issueMemo = productIssues[barcode].memo;
        product.issueRemarks = productIssues[barcode].remarks;
      }
    });
    
    const products = Array.from(productMap.values())
      .sort((a, b) => (a.priority || 999) - (b.priority || 999))
      .slice(0, 300); // 300개로 제한 (속도 대폭 개선)
    
    // cacheManager의 setCache 사용
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
    return {
      products: [],
      productIssues: {},
      error: error.toString(),
      cached: false,
      loadTime: new Date() - startTime
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
      .slice(0, 600); // 최대 600개로 제한
    
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
      
      // 실제 데이터 존재 여부 확인
      const lastRow = sheet.getLastRow();
      const hasData = lastRow > 6;
      
      // 디버그 로그 추가
      console.log('getCurrentOrder 디버그:', {
        orderId: currentOrder.orderId,
        lastRow: lastRow,
        hasData: hasData,
        sheetName: sheet.getName()
      });
      
      // 실제 데이터 확인 (7행의 첫 번째 열 확인)
      if (lastRow >= 7) {
        try {
          const firstDataCell = sheet.getRange(7, 1).getValue();
          console.log('7행 첫 번째 셀 값:', firstDataCell);
        } catch (e) {
          console.log('7행 데이터 읽기 실패:', e);
        }
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
        orderNumber: currentOrder.orderNumber,
        hasData: hasData  // 데이터 존재 여부 추가
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

// 박스번호 문자열을 파싱하여 Map으로 변환하는 함수
// 예: "1(10), 2(5)" → Map { 1 => 10, 2 => 5 }
function parseBoxNumbers(boxNumberString) {
  const boxMap = new Map();
  
  if (!boxNumberString || typeof boxNumberString !== 'string') {
    return boxMap;
  }
  
  // 쉼표로 분리하고 각 항목을 파싱
  const items = boxNumberString.split(',').map(item => item.trim());
  
  items.forEach(item => {
    // "박스번호(수량)" 형식 파싱
    const match = item.match(/^(\d+)\((\d+)\)$/);
    if (match) {
      const boxNumber = match[1];
      const quantity = parseInt(match[2], 10);
      boxMap.set(boxNumber, quantity);
    }
  });
  
  return boxMap;
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
    const barcodes = []; // SmaregiData 조회용
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
          const barcode = String(data[i][0]);
          barcodes.push(barcode);
          
          results.push({
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
            searchText: searchableText,
            isServerResult: true,
            isRecent: false,
            isFrequent: false
          });
          
          console.log(`매치 발견: ${data[i][1]} - ${data[i][2]}`);
        }
      }
    }
    
    // SmaregiData도 함께 조회
    if (barcodes.length > 0) {
      const smaregiData = SmaregiDataService.getSmaregiDataByIds(barcodes);
      
      // 각 결과에 SmaregiData 추가
      results.forEach(product => {
        if (smaregiData[product.barcode]) {
          product.smaregiData = smaregiData[product.barcode];
        }
      });
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
      .slice(0, 200) // 상위 200개
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
      // Q열(17열)까지 읽기
      const data = sheet.getRange(7, 1, numRows, 17).getValues();
      
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
            id: 7 + i, // 행 번호를 id로 사용
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
            exportableQuantity: row[16] ? Number(row[16]) : null, // Q열: 출고가능수량
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
    boxBarcodes: getBoxBarcodesFromSheet(),
    maxLowStockDisplay: settings.maxLowStockDisplay || '50',
    // 음성 설정 추가
    voiceSettings: voiceSettings
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

// SmaregiData 캐시 강제 초기화
function forceRefreshSmaregiCache() {
  SmaregiDataService.clearCache();
  return { success: true, message: 'SmaregiData 캐시가 초기화되었습니다.' };
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
    
    // 보호된 컬럼 데이터 미리 읽기 (상태, 확정시간, 내보내기 관련)
    const lastRow = sheet.getLastRow();
    let protectedData = new Map(); // 바코드별 보호 데이터
    
    if (lastRow > 6) {
      const existingData = sheet.getRange(7, 1, lastRow - 6, 19).getValues();
      existingData.forEach((row, index) => {
        const barcode = String(row[0]);
        if (barcode) {
          // 기존 데이터에서 보호해야 할 필드들
          protectedData.set(barcode + '_' + index, {
            status: row[9],          // J열: 상태
            confirmedAt: row[10],    // K열: 확정시간
            exportedAt: row[13],     // N열: 내보내기시간
            csvConfirmed: row[14],   // O열: CSV확인
            boxNumbers: row[15],     // P열: 박스번호
            exportStatus: row[17],   // R열: 출고상태
            shippedAt: row[18]       // S열: 출고완료시간
          });
        }
      });
    }
    
    // 기존 데이터 삭제 (한 번만 수행)
    if (lastRow > 6) {
      sheet.deleteRows(7, lastRow - 6);
    }
    
    // 새 데이터 추가
    if (items.length > 0) {
      const data = items.map((item, idx) => {
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
        } else if (!isNaN(stockAvailable) && stockAvailable !== '' && stockAvailable !== '미확인') {
          // L열에 숫자만 있는 경우 처리
          const availableQty = parseInt(stockAvailable);
          exportableQty = Math.min(availableQty, item.quantity);
        }
        // '가능'인 경우는 요청수량 그대로
        
        // 보호된 데이터 찾기 (바코드와 인덱스 기반)
        const protectedKey = item.barcode + '_' + idx;
        const protected = protectedData.get(protectedKey);
        
        // 같은 바코드의 기존 데이터도 확인 (인덱스가 다를 수 있음)
        let fallbackProtected = null;
        if (!protected) {
          // 모든 보호 데이터에서 같은 바코드 찾기
          for (const [key, value] of protectedData) {
            if (key.startsWith(item.barcode + '_')) {
              fallbackProtected = value;
              break;
            }
          }
        }
        
        const finalProtected = protected || fallbackProtected;
        
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
          // J열: 상태 - 보호된 데이터가 있고 '확정'이면 유지
          (finalProtected && finalProtected.status === '확정') ? '확정' : (item.status || '대기'),
          // K열: 확정시간 - 보호된 데이터가 있으면 유지
          (finalProtected && finalProtected.confirmedAt) || item.confirmedAt || '',
          stockAvailable,                   // L열: 재고가능여부
          item.supplierName || '',          // M열
          // N열: 내보내기시간 - 보호된 데이터가 있으면 유지
          (finalProtected && finalProtected.exportedAt) || item.exportedAt || '',
          // O열: CSV확인 - 보호된 데이터가 있으면 유지
          (finalProtected && finalProtected.csvConfirmed) || (item.csvConfirmed ? '✓' : ''),
          // P열: 박스번호 - 보호된 데이터가 있으면 유지
          (finalProtected && finalProtected.boxNumbers) || item.boxNumbers || '',
          exportableQty                     // Q열: 출고가능수량
        ];
      });
      
      // 19열까지 새 데이터 쓰기 (P열, R열, S열 포함)
      // 보호된 데이터에서 R, S열 복원
      const fullData = data.map((row, index) => {
        const barcode = String(row[0]);
        const protectedKey = barcode + '_' + index;
        const protected = protectedData.get(protectedKey);
        
        // 같은 바코드의 보호 데이터 찾기 (fallback)
        let fallbackProtected = null;
        if (!protected) {
          for (const [key, value] of protectedData) {
            if (key.startsWith(barcode + '_')) {
              fallbackProtected = value;
              break;
            }
          }
        }
        
        const finalProtected = protected || fallbackProtected;
        
        // R열, S열 데이터 복원
        const rColumn = (finalProtected && finalProtected.exportStatus) || '';
        const sColumn = (finalProtected && finalProtected.shippedAt) || '';
        
        // 17개 컬럼에 R, S 컬럼 추가
        return [...row, rColumn, sColumn];
      });
      
      // 19열까지 데이터 쓰기
      sheet.getRange(7, 1, fullData.length, 19).setValues(fullData);
      
      // R열, S열은 이미 fullData에 포함되어 함께 저장됨
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
    
    // 헤더 업데이트 - 19열까지 확인
    const lastCol = sheet.getLastColumn();
    const numCols = Math.max(19, lastCol);
    const headers = sheet.getRange(6, 1, 1, numCols).getValues()[0];
    
    if (headers[13] !== '내보내기시간') {
      sheet.getRange(6, 14).setValue('내보내기시간');
    }
    if (headers[14] !== 'CSV확인') {
      sheet.getRange(6, 15).setValue('CSV확인');
    }
    if (headers[15] !== '박스번호') {
      sheet.getRange(6, 16).setValue('박스번호');
    }
    if (headers[16] !== '출고가능수량') {
      sheet.getRange(6, 17).setValue('출고가능수량');
    }
    if (headers[17] !== '출고상태') {
      sheet.getRange(6, 18).setValue('출고상태').setFontWeight('bold').setBackground('#f0f0f0');
    }
    if (headers[18] !== '출고완료시간') {
      sheet.getRange(6, 19).setValue('출고완료시간').setFontWeight('bold').setBackground('#f0f0f0');
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
    // orderId로 스프레드시트 열기
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    
    if (!orderSheet) {
      throw new Error('발주서 시트를 찾을 수 없습니다.');
    }
    
    // 미출고 데이터 저장
    const undeliveredItems = saveUndeliveredItems(orderSheet);
    
    // 마감 상태를 발주서에 기록 (예: B5 셀)
    orderSheet.getRange(5, 2).setValue('마감됨');
    orderSheet.getRange(5, 3).setValue(new Date());
    orderSheet.getRange(5, 4).setValue(Session.getActiveUser().getEmail());
    
    // 발주서 보호 설정
    const protection = orderSheet.protect()
      .setDescription('마감된 발주서')
      .setWarningOnly(false);
    
    // 편집 권한 제거 (소유자 제외)
    const me = Session.getEffectiveUser();
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
    
    return {
      success: true,
      undeliveredCount: undeliveredItems.length,
      message: `발주서가 마감되었습니다. 미출고 항목: ${undeliveredItems.length}개`
    };
  } catch (error) {
    console.error('발주서 마감 중 오류:', error);
    return { success: false, error: error.toString() };
  }
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

// 출고가능수량 계산 헬퍼 함수
function calculateExportableQuantity(row) {
  const stockStatus = String(row[11] || '');
  let calculatedQty = Number(row[3]); // 기본값은 요청수량
  
  if (stockStatus === '품절' || stockStatus === '오더중') {
    calculatedQty = 0;
  } else if (stockStatus.includes('개만 가능')) {
    const match = stockStatus.match(/(\d+)개만 가능/);
    if (match) {
      calculatedQty = Math.min(parseInt(match[1]), Number(row[3]));
    }
  } else if (!isNaN(stockStatus) && stockStatus !== '' && stockStatus !== '미확인') {
    calculatedQty = Math.min(parseInt(stockStatus), Number(row[3]));
  }
  
  return calculatedQty;
}

// 발주서 헤더 확인 및 설정
function ensureOrderSheetHeaders(sheet) {
  try {
    const lastCol = sheet.getLastColumn();
    
    // R열(18번째) 헤더 확인/설정
    if (lastCol < 18 || !sheet.getRange(6, 18).getValue()) {
      sheet.getRange(6, 18).setValue('출고상태');
      sheet.getRange(6, 18).setFontWeight('bold');
      sheet.getRange(6, 18).setBackground('#f0f0f0');
    }
    
    // S열(19번째) 헤더 확인/설정
    if (lastCol < 19 || !sheet.getRange(6, 19).getValue()) {
      sheet.getRange(6, 19).setValue('출고완료시간');
      sheet.getRange(6, 19).setFontWeight('bold');
      sheet.getRange(6, 19).setBackground('#f0f0f0');
      sheet.setColumnWidth(19, 120);
    }
  } catch (error) {
    console.error('헤더 설정 중 오류:', error);
  }
}

// P열에서 스캔된 수량 파싱
function parseScannedQuantityFromBoxNumbers(boxNumbers) {
  if (!boxNumbers || !boxNumbers.trim()) return 0;
  
  let totalQty = 0;
  const matches = boxNumbers.match(/\d+\s*\(\s*\d+\s*\)/g);
  
  if (matches) {
    matches.forEach(match => {
      const qtyMatch = match.match(/\d+\s*\(\s*(\d+)\s*\)/);
      if (qtyMatch) {
        totalQty += parseInt(qtyMatch[1]);
      }
    });
  }
  
  return totalQty;
}

// 박스번호 병합 함수 (중복 제거 및 정렬)
function mergeBoxNumbers(existing, newBoxInfo) {
  const boxMap = new Map();
  
  // 기존 박스번호 파싱
  if (existing && existing.trim()) {
    const matches = existing.match(/\d+\s*\(\s*\d+\s*\)/g);
    if (matches) {
      matches.forEach(match => {
        const parsed = match.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
        if (parsed) {
          const boxNum = parsed[1];
          const qty = parseInt(parsed[2]);
          boxMap.set(boxNum, (boxMap.get(boxNum) || 0) + qty);
        }
      });
    }
  }
  
  // 새 박스번호 추가
  if (newBoxInfo && newBoxInfo.trim()) {
    const matches = newBoxInfo.match(/\d+\s*\(\s*\d+\s*\)/g);
    if (matches) {
      matches.forEach(match => {
        const parsed = match.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
        if (parsed) {
          const boxNum = parsed[1];
          const qty = parseInt(parsed[2]);
          boxMap.set(boxNum, (boxMap.get(boxNum) || 0) + qty);
        }
      });
    } else {
      // 단순 형식 처리 (예: "1(5)")
      const parsed = newBoxInfo.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
      if (parsed) {
        const boxNum = parsed[1];
        const qty = parseInt(parsed[2]);
        boxMap.set(boxNum, (boxMap.get(boxNum) || 0) + qty);
      }
    }
  }
  
  // 정렬하여 문자열로 변환
  const result = Array.from(boxMap.entries())
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([box, qty]) => `${box}(${qty})`)
    .join(', ');
  
  return result;
}

// 내보내기 완료된 항목 조회 (P열 기반 실시간 계산)
function getExportedItems(orderId) {
  console.log('=== getExportedItems 시작 ===');
  console.log('받은 orderId:', orderId);
  
  try {
    // orderId가 없으면 현재 발주서 확인
    if (!orderId) {
      console.log('orderId가 없어 getCurrentOrder() 호출');
      const currentOrder = getCurrentOrder();
      
      if (!currentOrder || !currentOrder.orderId) {
        console.error('현재 발주서 정보가 없습니다');
        return { 
          success: false, 
          message: '발주서가 선택되지 않았습니다.', 
          items: [],
          currentBoxNumber: 1
        };
      }
      
      orderId = currentOrder.orderId;
      console.log('getCurrentOrder()에서 가져온 orderId:', orderId);
    }
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      console.error('발주서 시트를 찾을 수 없습니다');
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.', items: [] };
    }
    
    const lastRow = sheet.getLastRow();
    console.log('전체 행 수:', lastRow);
    
    if (lastRow <= 6) {
      console.log('데이터 행이 없음');
      return { success: true, items: [], currentBoxNumber: 1 };
    }
    
    // 모든 데이터 읽기
    const numRows = lastRow - 6;
    console.log('데이터 행 수:', numRows);
    
    // R열(18번째)과 S열(19번째)까지 읽기 위해 최소 19열까지 읽기
    const lastCol = sheet.getLastColumn();
    const numCols = Math.max(19, lastCol);
    const data = sheet.getRange(7, 1, numRows, numCols).getValues();
    console.log('데이터 읽기 완료, 컬럼 수:', numCols);
    
    // 바코드별로 그룹화 (출고.md의 중복 바코드 처리 로직 적용)
    const barcodeMap = new Map();
    
    let processedCount = 0;
    let skippedCount = 0;
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      // 내보내기 시간이 있는 항목만 (N열)
      if (row[13] && row[0]) {
        const barcode = String(row[0]);
        const status = String(row[9] || '');
        
        // R열(출고상태) 확인
        const shippingStatus = row.length > 17 ? String(row[17] || '') : '';
        const isShippingCompleted = shippingStatus === '출고완료';
        
        processedCount++;
        
        if (!barcodeMap.has(barcode)) {
          barcodeMap.set(barcode, {
            barcode: barcode,
            name: String(row[1] || ''),
            option: String(row[2] || ''),
            supplierName: String(row[12] || ''),
            totalExportQuantity: 0,
            totalScannedQuantity: 0,
            boxNumbers: [],
            boxNumbersMap: new Map(), // 박스번호별 수량 관리
            rowIndices: []
          });
        }
        
        const item = barcodeMap.get(barcode);
        item.rowIndices.push(i + 7);
        
        // Q열(출고가능수량) 합산
        const exportableQty = row[16];
        if (exportableQty !== '' && exportableQty !== null) {
          item.totalExportQuantity += Number(exportableQty);
        } else {
          // Q열이 비어있으면 L열 기반 계산
          const stockStatus = String(row[11] || '');
          let calculatedQty = Number(row[3]); // 기본값은 요청수량
          
          if (stockStatus === '품절' || stockStatus === '오더중') {
            calculatedQty = 0;
          } else if (stockStatus.includes('개만 가능')) {
            const match = stockStatus.match(/(\d+)개만 가능/);
            if (match) {
              calculatedQty = Math.min(parseInt(match[1]), Number(row[3]));
            }
          } else if (!isNaN(stockStatus) && stockStatus !== '' && stockStatus !== '미확인') {
            calculatedQty = Math.min(parseInt(stockStatus), Number(row[3]));
          }
          
          item.totalExportQuantity += calculatedQty;
        }
        
        // P열(박스번호) 파싱 - 중복 제거 로직 적용
        const boxNumbers = row[15] || '';
        if (boxNumbers && boxNumbers.trim()) {
          const matches = boxNumbers.match(/\d+\s*\(\s*\d+\s*\)/g);
          if (matches) {
            matches.forEach(match => {
              const qtyMatch = match.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
              if (qtyMatch) {
                const boxNum = qtyMatch[1];
                const qty = parseInt(qtyMatch[2]);
                
                // 박스번호별 수량 누적 (중복 제거)
                if (item.boxNumbersMap.has(boxNum)) {
                  item.boxNumbersMap.set(boxNum, item.boxNumbersMap.get(boxNum) + qty);
                } else {
                  item.boxNumbersMap.set(boxNum, qty);
                }
              }
            });
          }
        }
      }
    }
    
    // 박스번호 맵을 배열로 변환하고 총 스캔 수량 계산
    barcodeMap.forEach(item => {
      // 박스번호 정렬 및 문자열 생성
      const sortedBoxes = Array.from(item.boxNumbersMap.entries())
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([box, qty]) => `${box}(${qty})`);
      
      item.boxNumbers = sortedBoxes;
      item.totalScannedQuantity = Array.from(item.boxNumbersMap.values())
        .reduce((sum, qty) => sum + qty, 0);
    });
    
    // 최종 항목 생성 (그룹화된 데이터)
    const items = [];
    barcodeMap.forEach(item => {
      const remainingQuantity = Math.max(0, item.totalExportQuantity - item.totalScannedQuantity);
      
      // 내보내기된 항목은 모두 포함 (잔여수량 0이어도)
      items.push({
        barcode: item.barcode,
        name: item.name,
        option: item.option,
        supplierName: item.supplierName,
        quantity: item.totalExportQuantity,
        scannedQuantity: item.totalScannedQuantity,
        remainingQuantity: remainingQuantity,
        boxNumbers: item.boxNumbers.join(', '),
        rowIndices: item.rowIndices
      });
    });
    
    // 현재 박스번호 가져오기
    let currentBoxNumber = 1;
    try {
      currentBoxNumber = getOrderBoxNumber(orderId);
    } catch (e) {
      console.warn('박스번호 조회 실패:', e);
    }
    
    console.log(`\n=== 처리 결과 ===`);
    console.log(`전체 행: ${data.length}`);
    console.log(`처리된 행: ${processedCount}`);
    console.log(`스킵된 행: ${skippedCount}`);
    console.log(`내보내기 시간 없는 행: ${data.length - processedCount - skippedCount}`);
    console.log(`최종 항목 수: ${items.length}개`);
    
    return {
      success: true,
      items: items,
      currentBoxNumber: currentBoxNumber,
      message: `${items.length}개 항목을 로드했습니다.`
    };
    
  } catch (error) {
    console.error('=== getExportedItems 에러 ===');
    console.error('에러 메시지:', error.toString());
    console.error('에러 스택:', error.stack);
    
    // 에러가 발생해도 기본값 반환
    return {
      success: false,
      message: error.toString(),
      items: [],
      currentBoxNumber: 1
    };
  }
}

// 중복 내보내기 항목 병합 함수
function mergeDuplicateExportedItems(items) {
  const itemMap = new Map();
  
  items.forEach(item => {
    const key = item.barcode;
    
    if (itemMap.has(key)) {
      // 이미 존재하는 항목이면 수량과 박스 정보 합치기
      const existingItem = itemMap.get(key);
      
      // 수량 합계
      existingItem.quantity += item.quantity;
      existingItem.originalQuantity += item.originalQuantity;
      existingItem.scannedQuantity += item.scannedQuantity;
      existingItem.remainingQuantity += item.remainingQuantity;
      
      // 박스번호 병합 (중복 제거)
      if (item.boxNumbers) {
        if (existingItem.boxNumbers) {
          // 기존 박스번호 파싱
          const existingBoxes = existingItem.boxNumbers.match(/\d+\(\d+\)/g) || [];
          const newBoxes = item.boxNumbers.match(/\d+\(\d+\)/g) || [];
          
          // 박스 정보를 Map으로 저장
          const boxMap = new Map();
          
          // 기존 박스 정보 추가
          existingBoxes.forEach(box => {
            const [, boxNum, qty] = box.match(/(\d+)\((\d+)\)/);
            boxMap.set(boxNum, (boxMap.get(boxNum) || 0) + parseInt(qty));
          });
          
          // 새 박스 정보 추가
          newBoxes.forEach(box => {
            const [, boxNum, qty] = box.match(/(\d+)\((\d+)\)/);
            boxMap.set(boxNum, (boxMap.get(boxNum) || 0) + parseInt(qty));
          });
          
          // 박스번호 문자열 재구성
          const sortedBoxes = Array.from(boxMap.entries())
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
            .map(([boxNum, qty]) => `${boxNum}(${qty})`);
          
          existingItem.boxNumbers = sortedBoxes.join(', ');
        } else {
          existingItem.boxNumbers = item.boxNumbers;
        }
      }
      
      // 내보내기 시간은 최신 것으로 업데이트
      if (item.exportedAt > existingItem.exportedAt) {
        existingItem.exportedAt = item.exportedAt;
      }
      
      // rowIndices 배열에 모든 행 번호 저장 (나중에 업데이트용)
      if (!existingItem.rowIndices) {
        existingItem.rowIndices = [existingItem.rowIndex];
      }
      existingItem.rowIndices.push(item.rowIndex);
      
    } else {
      // 새 항목이면 추가
      item.rowIndices = [item.rowIndex];
      itemMap.set(key, item);
    }
  });
  
  return Array.from(itemMap.values());
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

// 출고 데이터 저장 (분산 저장 로직 적용)
function saveShippingData(orderId, shippingData) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      throw new Error('발주서 시트를 찾을 수 없습니다.');
    }
    
    // R열, S열 헤더 확인 및 설정
    ensureOrderSheetHeaders(sheet);
    
    // 출고완료 상태 행의 P열 데이터 보호를 위한 백업
    const lastRow = sheet.getLastRow();
    const protectedRows = [];
    
    if (lastRow > 6) {
      // R열이 없을 수도 있으므로 컬럼 수 확인
      const lastCol = sheet.getLastColumn();
      if (lastCol >= 18) {
        const shippingStatusData = sheet.getRange(7, 18, lastRow - 6, 1).getValues(); // R열 (출고상태)
        const pColumnData = sheet.getRange(7, 16, lastRow - 6, 1).getValues(); // P열
        
        for (let i = 0; i < shippingStatusData.length; i++) {
          if (shippingStatusData[i][0] === '출고완료' && pColumnData[i][0]) {
            protectedRows.push({
              rowIndex: i + 7,
              boxNumbers: pColumnData[i][0]
            });
          }
        }
      }
      
      console.log(`보호된 행 수: ${protectedRows.length}`);
    }
    
    // 박스 번호만 사용 (박스 이름이 아닌)
    const boxNumber = shippingData.boxName.match(/(\d+)번/)?.[1] || 
                     shippingData.boxNumber || 
                     shippingData.boxName;
    
    // 패킹 데이터 수집용 배열
    const packingDataArray = [];
    
    // 각 항목의 박스정보 업데이트 (순차적 처리 로직)
    shippingData.items.forEach((item) => {
      
      // 동일한 바코드를 가진 모든 행 찾기
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      const numCols = Math.max(19, lastCol); // 최소 S열까지 읽기
      const data = sheet.getRange(7, 1, lastRow - 6, numCols).getValues();
      const rowDataList = [];
      
      // 내보내기 시간이 있고 출고완료되지 않은 행만 수집 (순서대로)
      for (let i = 0; i < data.length; i++) {
        const rowBarcode = String(data[i][0]);
        const exportTime = data[i][13]; // N열 (내보내기시간)
        
        if (rowBarcode === item.barcode && exportTime) { // N열 체크
          // R열(17번 인덱스) 확인 - 출고완료된 행은 제외
          const shippingStatus = data[i].length > 17 ? String(data[i][17] || '') : '';
          
          if (shippingStatus !== '출고완료') {
            rowDataList.push({
              rowIndex: i + 7,
              rowData: data[i]
            });
          }
        }
      }
      
      if (rowDataList.length === 0) {
        return;
      }
      
      // 순차적으로 처리할 남은 수량
      let remainingToScan = item.scannedInThisBox;
      
      // 각 행을 순차적으로 처리 (위에서부터)
      for (let i = 0; i < rowDataList.length && remainingToScan > 0; i++) {
        const {rowIndex, rowData} = rowDataList[i];
        
        const currentBoxNumbers = rowData[15] || ''; // P열
        const exportableQty = Number(rowData[16] || rowData[3]); // Q열 또는 D열
        
        // 이미 스캔된 수량 계산
        const alreadyScanned = parseScannedQuantityFromBoxNumbers(currentBoxNumbers);
        
        // 이 행에서 더 스캔 가능한 수량
        const rowRemainingQty = Math.max(0, exportableQty - alreadyScanned);
        
        if (rowRemainingQty > 0) {
          // 이 행에서 처리할 수량 (남은 수량과 행의 남은 수량 중 작은 값)
          const toScanInRow = Math.min(remainingToScan, rowRemainingQty);
          
          // P열 업데이트 (mergeBoxNumbers 사용)
          const newBoxInfo = `${boxNumber}(${toScanInRow})`;
          const updatedBoxNumbers = mergeBoxNumbers(currentBoxNumbers, newBoxInfo);
          
          sheet.getRange(rowIndex, 16).setValue(updatedBoxNumbers);
          
          // 패킹 데이터 수집
          packingDataArray.push({
            barcode: item.barcode,
            name: item.name,
            option: item.option,
            quantity: toScanInRow,
            boxNumber: boxNumber
          });
          
          remainingToScan -= toScanInRow;
          
          // 출고 완료 체크
          const newTotalScanned = alreadyScanned + toScanInRow;
          if (newTotalScanned >= exportableQty) {
            // R열(18번째)에 출고 상태 기록
            sheet.getRange(rowIndex, 18).setValue('출고완료');
            // 출고완료 시간도 함께 기록 (S열, 19번째)
            sheet.getRange(rowIndex, 19).setValue(new Date());
          } else if (newTotalScanned > 0) {
            // 부분 출고 상태
            sheet.getRange(rowIndex, 18).setValue('부분출고');
          }
        }
      }
      
      // 모든 수량을 처리하지 못한 경우 경고
      if (remainingToScan > 0) {
        console.warn(`경고: ${item.barcode} 항목의 ${remainingToScan}개를 처리하지 못했습니다.`);
      }
    });
    
    // 출고 이력 저장
    saveShippingHistory(ss, shippingData, boxNumber);
    
    // 패킹리스트 업데이트 (수집된 데이터로)
    if (packingDataArray.length > 0) {
      updatePackingListWithData(ss, packingDataArray, boxNumber);
    }
    
    // 변경사항 즉시 반영
    SpreadsheetApp.flush();
    
    // 보호된 행의 P열 데이터 복원 (혹시 잘못 수정된 경우를 대비)
    protectedRows.forEach(({rowIndex, boxNumbers}) => {
      const currentValue = sheet.getRange(rowIndex, 16).getValue();
      if (currentValue !== boxNumbers) {
        console.log(`보호된 행 ${rowIndex}의 P열 복원: "${currentValue}" → "${boxNumbers}"`);
        sheet.getRange(rowIndex, 16).setValue(boxNumbers);
      }
    });
    
    return {
      success: true,
      message: `${boxNumber}번 박스 출고 완료`,
      savedItems: packingDataArray.length
    };
    
  } catch (error) {
    console.error('출고 데이터 저장 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// P열 업데이트 테스트 함수
// P열 업데이트 함수
function updatePColumn(orderId, barcode, boxInfo) {
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(7, 1, lastRow - 6, 16).getValues();
    
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(barcode)) {
        const rowIndex = i + 7;
        console.log(`행 ${rowIndex} 발견`);
        
        // P열 직접 업데이트
        const range = sheet.getRange(rowIndex, 16);
        range.setValue(boxInfo);
        SpreadsheetApp.flush();
        
        // 확인
        const newValue = range.getValue();
        console.log(`업데이트 결과: "${newValue}"`);
        
        return { success: true, message: `행 ${rowIndex} P열 업데이트 완료` };
      }
    }
    
    return { success: false, message: '바코드를 찾을 수 없음' };
    
  } catch (error) {
    console.error('테스트 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 디버깅용 함수 - P열 확인
function checkPColumn(orderId, barcode) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(7, 1, lastRow - 6, 20).getValues();
    
    console.log('=== P열 상태 확인 ===');
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(barcode)) {
        console.log(`행 ${i + 7}:`);
        console.log(`  바코드: ${data[i][0]}`);
        console.log(`  상품명: ${data[i][1]}`);
        console.log(`  N열(내보내기시간): ${data[i][13]}`);
        console.log(`  O열(CSV확인): ${data[i][14]}`);
        console.log(`  P열(박스번호): "${data[i][15]}"`);
        console.log(`  Q열(출고가능수량): ${data[i][16]}`);
        console.log(`  R열(출고상태): ${data[i][17]}`);
        console.log(`  S열(출고완료시간): ${data[i][18]}`);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('P열 확인 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 출고상태 초기화 함수
function resetShippingStatus(orderId, barcode) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(7, 1, lastRow - 6, 20).getValues();
    
    let resetCount = 0;
    for (let i = 0; i < data.length; i++) {
      if (!barcode || String(data[i][0]) === String(barcode)) {
        const rowIndex = i + 7;
        
        // P열(16), R열(18), S열(19) 초기화
        sheet.getRange(rowIndex, 16).setValue(''); // P열: 박스번호
        sheet.getRange(rowIndex, 18).setValue(''); // R열: 출고상태
        sheet.getRange(rowIndex, 19).setValue(''); // S열: 출고완료시간
        
        resetCount++;
        console.log(`행 ${rowIndex} 출고 정보 초기화됨`);
        
        if (barcode) break; // 특정 바코드만 처리
      }
    }
    
    SpreadsheetApp.flush();
    return { success: true, message: `${resetCount}개 행 초기화 완료` };
    
  } catch (error) {
    console.error('출고상태 초기화 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 출고 이력 저장
function saveShippingHistory(spreadsheet, shippingData, boxNumber) {
  let historySheet = spreadsheet.getSheetByName('출고이력');
  
  if (!historySheet) {
    historySheet = spreadsheet.insertSheet('출고이력');
    // 헤더 설정
    const headers = ['출고일시', '박스번호', '바코드', '상품명', '옵션', '수량', '담당자', '행번호'];
    historySheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    historySheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  
  const timestamp = new Date();
  const user = Session.getActiveUser().getEmail();
  
  // 이력 데이터 생성 (바코드당 한 번만 기록)
  const historyData = [];
  shippingData.items.forEach(item => {
    historyData.push([
      timestamp,
      boxNumber, // 박스 번호만 저장
      item.barcode,
      item.name,
      item.option,
      item.scannedInThisBox,
      user,
      '' // 행번호는 불필요 (모든 행에 동일하게 기록되므로)
    ]);
  });
  
  if (historyData.length > 0) {
    const lastRow = historySheet.getLastRow();
    historySheet.getRange(lastRow + 1, 1, historyData.length, 8).setValues(historyData);
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

// 설정에 박스번호 관련 추가
function getSettings() {
  const userProperties = PropertiesService.getUserProperties();
  const settings = userProperties.getProperties();
  
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
    // 박스 설정
    boxMode: settings.boxMode || 'barcode',
    boxDigits: settings.boxDigits || '3',
    boxBarcodes: boxBarcodes // 스프레드시트에서 가져온 데이터
  };
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

// 패킹리스트 업데이트 (분산 저장된 데이터 사용)
function updatePackingListWithData(spreadsheet, packingDataArray, boxNumber) {
  try {
    // 패킹리스트 시트 가져오기 또는 생성
    let packingSheet = spreadsheet.getSheetByName('패킹리스트');
    
    if (!packingSheet) {
      packingSheet = createPackingListSheet(spreadsheet);
    }
    
    const timestamp = new Date();
    const user = Session.getActiveUser().getEmail();
    
    // 각 아이템별로 패킹리스트에 추가
    packingDataArray.forEach(item => {
      // 기존 행 찾기 (바코드-박스번호 조합)
      const lastRow = packingSheet.getLastRow();
      let existingRow = -1;
      
      if (lastRow > 1) {
        const data = packingSheet.getRange(2, 1, lastRow - 1, 5).getValues();
        for (let i = 0; i < data.length; i++) {
          if (String(data[i][0]) === item.barcode && String(data[i][4]) === String(boxNumber)) {
            existingRow = i + 2;
            break;
          }
        }
      }
      
      if (existingRow > 0) {
        // 기존 행 업데이트 (수량 누적)
        const currentQty = packingSheet.getRange(existingRow, 4).getValue();
        packingSheet.getRange(existingRow, 4).setValue(currentQty + item.quantity);
        packingSheet.getRange(existingRow, 11).setValue(timestamp); // 수정시간
      } else {
        // 새 행 추가
        const newRow = [
          item.barcode,
          item.name,
          item.option,
          item.quantity,
          boxNumber,
          '', // 메모
          '', // 비고
          timestamp,
          'N', // 임시저장
          user,
          timestamp
        ];
        packingSheet.appendRow(newRow);
      }
    });
    
    console.log(`패킹리스트 업데이트 완료: ${packingDataArray.length}개 항목`);
    
  } catch (error) {
    console.error('패킹리스트 업데이트 실패:', error);
  }
}

// 출고 데이터 무결성 체크
function checkShippingIntegrity(orderId) {
  console.log('=== checkShippingIntegrity 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    const historySheet = ss.getSheetByName('출고이력');
    const packingSheet = ss.getSheetByName('패킹리스트');
    
    const issues = [];
    
    if (!orderSheet) {
      return {
        success: false,
        message: '발주서 시트를 찾을 수 없습니다.'
      };
    }
    
    // 1. P열과 출고이력 비교
    if (historySheet && historySheet.getLastRow() > 1) {
      const historyData = {};
      const history = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, 8).getValues();
      
      // 출고이력 집계
      history.forEach(row => {
        const barcode = String(row[2]);
        const boxNumber = String(row[1]);
        const quantity = row[5];
        
        if (!historyData[barcode]) {
          historyData[barcode] = {};
        }
        if (!historyData[barcode][boxNumber]) {
          historyData[barcode][boxNumber] = 0;
        }
        historyData[barcode][boxNumber] += quantity;
      });
      
      // P열 데이터와 비교
      const lastRow = orderSheet.getLastRow();
      if (lastRow > 6) {
        const orderData = orderSheet.getRange(7, 1, lastRow - 6, 17).getValues();
        
        for (let i = 0; i < orderData.length; i++) {
          const barcode = String(orderData[i][0]);
          const pColumn = orderData[i][15] || '';
          
          if (pColumn) {
            const pColumnData = {};
            const matches = pColumn.match(/\d+\s*\(\s*\d+\s*\)/g);
            
            if (matches) {
              matches.forEach(match => {
                const parsed = match.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                if (parsed) {
                  pColumnData[parsed[1]] = parseInt(parsed[2]);
                }
              });
            }
            
            // 비교
            const historyBoxes = historyData[barcode] || {};
            
            Object.keys(pColumnData).forEach(box => {
              const pQty = pColumnData[box];
              const historyQty = historyBoxes[box] || 0;
              
              if (pQty !== historyQty) {
                issues.push({
                  type: 'mismatch',
                  severity: 'warning',
                  barcode: barcode,
                  row: i + 7,
                  message: `박스 ${box}: P열=${pQty}, 출고이력=${historyQty}`,
                  details: {
                    boxNumber: box,
                    pColumnQty: pQty,
                    historyQty: historyQty
                  }
                });
              }
            });
          }
        }
      }
    }
    
    // 2. 패킹리스트 중복 체크
    if (packingSheet && packingSheet.getLastRow() > 1) {
      const packingData = packingSheet.getRange(2, 1, packingSheet.getLastRow() - 1, 5).getValues();
      const seen = new Set();
      
      packingData.forEach((row, index) => {
        const key = `${row[0]}_${row[4]}`; // 바코드_박스번호
        
        if (seen.has(key)) {
          issues.push({
            type: 'duplicate',
            severity: 'critical',
            message: `패킹리스트 중복: ${row[0]} - 박스 ${row[4]}`,
            row: index + 2,
            barcode: row[0],
            boxNumber: row[4]
          });
        }
        
        seen.add(key);
      });
    }
    
    // 3. 수량 일관성 검증
    const lastRow = orderSheet.getLastRow();
    if (lastRow > 6) {
      const orderData = orderSheet.getRange(7, 1, lastRow - 6, 17).getValues();
      
      for (let i = 0; i < orderData.length; i++) {
        const requestedQty = orderData[i][3] || 0;
        const exportableQty = orderData[i][16] || requestedQty;
        const boxNumbers = orderData[i][15] || '';
        
        if (boxNumbers) {
          const scannedQty = parseScannedQuantityFromBoxNumbers(boxNumbers);
          
          if (scannedQty > exportableQty) {
            issues.push({
              type: 'excess',
              severity: 'critical',
              barcode: orderData[i][0],
              row: i + 7,
              message: `출고 초과: 스캔=${scannedQty}, 출고가능=${exportableQty}`,
              details: {
                scannedQty: scannedQty,
                exportableQty: exportableQty,
                excess: scannedQty - exportableQty
              }
            });
          }
        }
      }
    }
    
    console.log(`무결성 체크 완료: ${issues.length}개 이슈 발견`);
    
    return {
      success: true,
      hasIssues: issues.length > 0,
      issues: issues,
      critical: issues.some(issue => issue.severity === 'critical'),
      summary: {
        total: issues.length,
        critical: issues.filter(i => i.severity === 'critical').length,
        warning: issues.filter(i => i.severity === 'warning').length
      }
    };
    
  } catch (error) {
    console.error('무결성 체크 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 발주서 마감 시 나머지 수량 자동 추가
function addRemainingQuantityItems(orderId) {
  console.log('=== addRemainingQuantityItems 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      throw new Error('발주서 시트를 찾을 수 없습니다.');
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 6) {
      return {
        success: true,
        message: '처리할 항목이 없습니다.',
        addedCount: 0
      };
    }
    
    // 기존 데이터 읽기
    const data = sheet.getRange(7, 1, lastRow - 6, 17).getValues();
    const itemsToAdd = [];
    
    // 나머지 수량이 있는 항목 찾기
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const barcode = String(row[0]);
      const name = row[1];
      const option = row[2];
      const requestedQty = row[3] || 0;
      const status = row[9];
      const stockStatus = row[11];
      const exportedTime = row[13];
      const boxNumbers = row[15] || '';
      const exportableQty = row[16] || requestedQty;
      
      // 내보내기 완료된 항목만 처리
      if (!exportedTime) continue;
      
      // R열의 출고상태 확인
      const shippingStatus = row.length > 17 ? row[17] : '';
      
      // 출고완료 상태면 스킵
      if (shippingStatus === '출고완료') continue;
      
      // 실제 출고된 수량 계산
      const scannedQty = parseScannedQuantityFromBoxNumbers(boxNumbers);
      
      // 나머지 수량 계산
      const remainingQty = Math.max(0, requestedQty - exportableQty);
      
      if (remainingQty > 0) {
        console.log(`${barcode}: 요청=${requestedQty}, 출고가능=${exportableQty}, 나머지=${remainingQty}`);
        
        // 재고 상태 메시지 생성
        let stockMessage = '';
        if (stockStatus === '품절') {
          stockMessage = '품절';
        } else if (stockStatus === '오더중') {
          stockMessage = '오더중';
        } else if (stockStatus.includes('개만 가능')) {
          stockMessage = stockStatus;
        } else {
          stockMessage = `${exportableQty}개만 가능`;
        }
        
        itemsToAdd.push({
          barcode: barcode,
          name: name,
          option: option,
          quantity: remainingQty,
          originalQty: requestedQty,
          exportableQty: exportableQty,
          comment: `자동추가 (${stockMessage} → ${remainingQty}개 부족)`,
          supplierName: row[12] || ''
        });
      }
    }
    
    // 새 항목 추가
    if (itemsToAdd.length > 0) {
      const newRows = itemsToAdd.map(item => [
        item.barcode,                    // A열: 바코드
        item.name,                        // B열: 상품명
        item.option,                      // C열: 옵션
        item.quantity,                    // D열: 수량
        '',                              // E열: 원가
        '',                              // F열: 금액
        '',                              // G열: 색상칩
        '',                              // H열: 우선순위
        item.comment,                     // I열: 코멘트
        '대기',                          // J열: 상태
        '',                              // K열: 확인
        '미확인',                        // L열: 재고상태
        item.supplierName,                // M열: 공급사명
        '',                              // N열: 내보내기시간
        '',                              // O열: CSV확인
        '',                              // P열: 박스번호
        ''                               // Q열: 출고가능수량
      ]);
      
      // 시트에 추가
      const startRow = lastRow + 1;
      sheet.getRange(startRow, 1, newRows.length, 17).setValues(newRows);
      
      // 시각적 구분을 위한 배경색 설정
      sheet.getRange(startRow, 1, newRows.length, 17).setBackground('#fff3cd'); // 연한 노란색
      
      // 자동추가 표시를 위한 테두리
      sheet.getRange(startRow, 1, newRows.length, 17).setBorder(
        true, true, true, true, false, false,
        '#ffc107', SpreadsheetApp.BorderStyle.SOLID_MEDIUM
      );
      
      console.log(`${itemsToAdd.length}개 항목 자동 추가 완료`);
    }
    
    return {
      success: true,
      message: `${itemsToAdd.length}개 항목이 자동으로 추가되었습니다.`,
      addedCount: itemsToAdd.length,
      addedItems: itemsToAdd
    };
    
  } catch (error) {
    console.error('나머지 수량 추가 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 데이터 동기화 함수 (출고이력 → 패킹리스트 → 발주서 P열)
function syncWithPackingList(orderId) {
  console.log('=== syncWithPackingList 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    const historySheet = ss.getSheetByName('출고이력');
    const packingSheet = ss.getSheetByName('패킹리스트');
    
    if (!orderSheet) {
      throw new Error('발주서 시트를 찾을 수 없습니다.');
    }
    
    // 1. 출고이력에서 실제 출고 데이터 수집
    const actualShippingData = {};
    
    if (historySheet && historySheet.getLastRow() > 1) {
      const historyData = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, 8).getValues();
      
      historyData.forEach(row => {
        const barcode = String(row[2]); // 바코드
        const boxNumber = String(row[1]); // 박스번호
        const quantity = row[5]; // 수량
        
        if (!actualShippingData[barcode]) {
          actualShippingData[barcode] = {};
        }
        
        if (!actualShippingData[barcode][boxNumber]) {
          actualShippingData[barcode][boxNumber] = 0;
        }
        
        actualShippingData[barcode][boxNumber] += quantity;
      });
      
      console.log('출고이력 데이터 수집 완료:', Object.keys(actualShippingData).length, '개 바코드');
    }
    
    // 2. 패킹리스트 데이터로 보완
    if (packingSheet && packingSheet.getLastRow() > 1) {
      const packingData = packingSheet.getRange(2, 1, packingSheet.getLastRow() - 1, 5).getValues();
      
      packingData.forEach(row => {
        const barcode = String(row[0]); // 바코드
        const boxNumber = String(row[4]); // 박스번호
        const quantity = row[3]; // 수량
        
        if (!actualShippingData[barcode]) {
          actualShippingData[barcode] = {};
        }
        
        // 패킹리스트의 수량이 더 크면 업데이트 (누락된 출고 정보 보완)
        if (!actualShippingData[barcode][boxNumber] || actualShippingData[barcode][boxNumber] < quantity) {
          actualShippingData[barcode][boxNumber] = quantity;
          console.log(`패킹리스트에서 보완: ${barcode} - 박스${boxNumber} - ${quantity}개`);
        }
      });
    }
    
    // 3. 발주서 P열 업데이트 (각 행의 개별 데이터 보존)
    const lastRow = orderSheet.getLastRow();
    if (lastRow > 6) {
      // R열(18번째)과 S열(19번째)까지 읽기 위해 최소 19열까지 읽기
      const lastCol = orderSheet.getLastColumn();
      const numCols = Math.max(19, lastCol);
      const orderData = orderSheet.getRange(7, 1, lastRow - 6, numCols).getValues();
      
      // 각 행별로 업데이트 필요 여부 확인
      let updateCount = 0;
      
      for (let i = 0; i < orderData.length; i++) {
        const rowIndex = i + 7;
        const barcode = String(orderData[i][0]);
        const currentBoxNumbers = orderData[i][15] || '';
        const status = orderData[i][9];
        const exportedTime = orderData[i][13];
        
        // 내보내기가 완료되지 않은 행은 건너뛰기
        if (!exportedTime) continue;
        
        // R열의 출고상태 확인 (R열은 18번째 열, 인덱스는 17)
        const shippingStatus = orderData[i].length > 17 ? String(orderData[i][17] || '') : '';
        
        // 이미 출고완료 상태인 행은 P열 데이터 보존
        if (shippingStatus === '출고완료') {
          console.log(`행 ${rowIndex}: 출고완료 상태이므로 P열 유지 - "${currentBoxNumbers}"`);
          continue;
        }
        
        // 현재 행의 P열 데이터를 실제 출고 데이터와 비교
        const shippingDataForBarcode = actualShippingData[barcode];
        
        if (shippingDataForBarcode) {
          // 현재 P열 데이터를 파싱
          const currentBoxMap = new Map();
          if (currentBoxNumbers) {
            const matches = currentBoxNumbers.match(/\d+\s*\(\s*\d+\s*\)/g);
            if (matches) {
              matches.forEach(match => {
                const parsed = match.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                if (parsed) {
                  currentBoxMap.set(parsed[1], parseInt(parsed[2]));
                }
              });
            }
          }
          
          // 실제 출고 데이터와 비교하여 누락된 부분만 추가
          let needsUpdate = false;
          Object.entries(shippingDataForBarcode).forEach(([box, qty]) => {
            const currentQty = currentBoxMap.get(box) || 0;
            if (currentQty < qty) {
              currentBoxMap.set(box, qty);
              needsUpdate = true;
            }
          });
          
          if (needsUpdate) {
            // 업데이트된 박스 정보를 문자열로 변환
            const updatedBoxNumbers = Array.from(currentBoxMap.entries())
              .sort(([a], [b]) => parseInt(a) - parseInt(b))
              .map(([box, qty]) => `${box}(${qty})`)
              .join(', ');
            
            orderSheet.getRange(rowIndex, 16).setValue(updatedBoxNumbers);
            updateCount++;
            console.log(`행 ${rowIndex} P열 업데이트: "${currentBoxNumbers}" → "${updatedBoxNumbers}"`);
          }
        }
      }
      
      console.log(`동기화 완료: ${updateCount}개 행 업데이트`);
    }
    
    return {
      success: true,
      message: '데이터 동기화가 완료되었습니다.',
      itemCount: Object.keys(actualShippingData).length,
      syncedRows: updateCount || 0
    };
    
  } catch (error) {
    console.error('동기화 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 패킹리스트 시트 생성
function createPackingListSheet(spreadsheet) {
  const packingSheet = spreadsheet.insertSheet('패킹리스트');
  
  // 헤더 설정
  const headers = ['바코드', '상품명', '옵션', '수량', '박스번호', '메모', '비고', '스캔시간', '임시저장', '작업자', '수정시간'];
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
  packingSheet.setColumnWidth(7, 150); // 비고
  packingSheet.setColumnWidth(8, 120); // 스캔시간
  packingSheet.setColumnWidth(9, 80);  // 임시저장
  packingSheet.setColumnWidth(10, 120); // 작업자
  packingSheet.setColumnWidth(11, 120); // 수정시간
  
  return packingSheet;
}

// 패킹리스트 자동 업데이트 함수
function updatePackingListAuto(spreadsheet, shippingData, boxNumber) {
  try {
    // 패킹리스트 시트 가져오기 또는 생성
    let packingSheet = spreadsheet.getSheetByName('패킹리스트');
    
    if (!packingSheet) {
      packingSheet = spreadsheet.insertSheet('패킹리스트');
      
      // 헤더 설정
      const headers = ['바코드', '상품명', '옵션', '수량', '박스번호', '메모', '비고', '스캔시간', '임시저장', '작업자', '수정시간'];
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
      packingSheet.setColumnWidth(9, 80);  // 임시저장
      packingSheet.setColumnWidth(10, 150); // 작업자
      packingSheet.setColumnWidth(11, 150); // 수정시간
    }
    
    // 패킹 데이터 생성
    const timestamp = new Date();
    const userEmail = Session.getActiveUser().getEmail() || 'Unknown';
    const packingData = shippingData.items.map(item => [
      item.barcode,
      item.name,
      item.option || '',
      item.scannedInThisBox,
      boxNumber,
      item.comment || '',
      item.stockAvailable || '',
      timestamp,
      'N', // 임시저장 아님
      userEmail,
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
        packingSheet.getRange(rowIndex, 1, 1, 11).setValues([data]);
      });
      
      // 새 항목 추가
      if (newItems.length > 0) {
        const startRow = packingSheet.getLastRow() + 1;
        packingSheet.getRange(startRow, 1, newItems.length, 11).setValues(newItems);
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

// 패킹 데이터 전체 초기화 (P, R, S열 포함)
function resetAllPackingData(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const orderSheet = ss.getSheetByName('발주서');
    
    if (!orderSheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.' };
    }
    
    // P열(박스번호), R열(출고상태), S열(출고완료시간) 초기화
    const lastRow = orderSheet.getLastRow();
    if (lastRow > 6) {
      const numRows = lastRow - 6;
      // P열(16), R열(18), S열(19) 한번에 초기화
      const clearRange = orderSheet.getRange(7, 16, numRows, 4); // P부터 S열까지 (16~19)
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
    
    // 임시 패킹 데이터 삭제
    const tempPackingKey = `tempPacking_${orderId}`;
    scriptProperties.deleteProperty(tempPackingKey);
    
    // 세션 삭제
    const userProperties = PropertiesService.getUserProperties();
    userProperties.deleteProperty('shippingSession');
    userProperties.deleteProperty('shippingSessionLocation');
    
    return {
      success: true,
      message: '모든 패킹 데이터가 초기화되었습니다.'
    };
    
  } catch (error) {
    console.error('패킹 데이터 초기화 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 출고완료 항목 디버깅 함수
function debugShippingCompletedItems(orderId) {
  console.log('=== 출고완료 항목 디버깅 시작 ===');
  
  // 테스트용 기본 orderId (실제 사용 시 변경 필요)
  if (!orderId) {
    orderId = '1eTIFbWZupx4BhX-PUmgXBNCx-l0BEsLG7GinlCGTNSA'; // ORDER_SHEET_ID
    console.log('기본 orderId 사용:', orderId);
  }
  
  try {
    const result = getExportedItems(orderId);
    
    if (!result.success) {
      console.error('데이터 로드 실패:', result.message);
      return;
    }
    
    console.log(`전체 내보내기 항목 수: ${result.items.length}`);
    
    const completedItems = result.items.filter(item => item.remainingQuantity === 0);
    console.log(`완료된 항목 수: ${completedItems.length}`);
    
    console.log('\n=== 완료된 항목 상세 ===');
    completedItems.forEach((item, index) => {
      console.log(`${index + 1}. ${item.barcode} - ${item.name}`);
      console.log(`   출고수량: ${item.quantity}, 스캔수량: ${item.scannedQuantity}, 잔여: ${item.remainingQuantity}`);
      console.log(`   박스번호: "${item.boxNumbers}"`);
    });
    
    console.log('\n=== 미완료 항목 상세 (처음 5개) ===');
    const incompleteItems = result.items.filter(item => item.remainingQuantity > 0);
    incompleteItems.slice(0, 5).forEach((item, index) => {
      console.log(`${index + 1}. ${item.barcode} - ${item.name}`);
      console.log(`   출고수량: ${item.quantity}, 스캔수량: ${item.scannedQuantity}, 잔여: ${item.remainingQuantity}`);
      console.log(`   박스번호: "${item.boxNumbers}"`);
    });
    
    return {
      total: result.items.length,
      completed: completedItems.length,
      incomplete: incompleteItems.length
    };
    
  } catch (error) {
    console.error('디버깅 중 오류:', error);
    console.error('에러 스택:', error.stack);
  }
}

// 출고완료된 항목 조회 (출고완료 탭용)
function getCompletedItems(orderId) {
  console.log('=== getCompletedItems 시작 ===');
  console.log('orderId:', orderId);
  
  try {
    if (!orderId) {
      return { success: false, message: '발주서 ID가 없습니다.', items: [] };
    }
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서 시트를 찾을 수 없습니다.', items: [] };
    }
    
    const items = [];
    const lastRow = sheet.getLastRow();
    console.log('전체 행 수:', lastRow);
    
    if (lastRow > 6) {
      const numRows = lastRow - 6;
      const data = sheet.getRange(7, 1, numRows, 17).getValues();
      
      let checkedCount = 0;
      let totalChecked = 0;
      
      console.log('데이터 행 수:', data.length);
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        totalChecked++;
        
        // P열(박스번호) 확인 - 15번째 인덱스 (0부터 시작)
        const boxNumbersValue = row[15];
        const boxNumbers = String(boxNumbersValue || '').trim();
        
        // 처음 10개 행과 박스번호가 있는 행은 모두 로그
        if (i < 10 || boxNumbers !== '') {
          console.log(`행 ${i+7}: 바코드=${row[0]}, 상태=${row[9]}, P열(박스번호)="${boxNumbers}", 타입=${typeof boxNumbersValue}`);
        }
        
        // 바코드가 있고 박스번호가 있는 항목만
        if (row[0] && boxNumbers !== '') {
          checkedCount++;
          console.log(`✓ 완료 항목 발견: 행 ${i+7}, 바코드=${row[0]}, 박스번호="${boxNumbers}"`);
          
          let scannedQuantity = 0;
          
          // 박스번호 파싱 "1(3), 2(7)" 형식
          const matches = boxNumbers.match(/\d+\s*\(\s*(\d+)\s*\)/g);
          if (matches) {
            matches.forEach(match => {
              const qtyMatch = match.match(/\(\s*(\d+)\s*\)/);
              if (qtyMatch && qtyMatch[1]) {
                scannedQuantity += parseInt(qtyMatch[1]);
              }
            });
          }
          
          // 출고가능수량 가져오기
          const exportableQty = row[16] || row[3]; // Q열 또는 D열
          const exportQuantity = Number(exportableQty) || 0;
          
          const item = {
            rowIndex: i + 7,
            barcode: String(row[0]),
            name: String(row[1] || ''),
            option: String(row[2] || ''),
            quantity: exportQuantity, // 출고가능수량
            originalQuantity: Number(row[3]) || 0, // 원래 요청수량
            supplierName: String(row[12] || ''),
            status: String(row[9] || ''),
            boxNumbers: boxNumbers,
            scannedQuantity: scannedQuantity,
            remainingQuantity: Math.max(0, exportQuantity - scannedQuantity)
          };
          
          items.push(item);
        }
      }
      
      console.log(`\n총 확인한 행: ${totalChecked}, 완료 항목: ${checkedCount}`);
    }
    
    // 중복 항목 병합 - 동일 바코드의 경우 병합하여 표시
    const mergedItems = mergeDuplicateCompletedItems(items);
    
    console.log('\n=== 완료 항목 최종 결과 ===');
    console.log(`병합 전: ${items.length}개, 병합 후: ${mergedItems.length}개`);
    mergedItems.forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.barcode}: scannedQuantity=${item.scannedQuantity}, boxNumbers="${item.boxNumbers}"`);
    });
    
    return {
      success: true,
      items: mergedItems, // 병합하지 않고 원본 반환
      message: `${items.length}개 완료 항목을 로드했습니다.`
    };
    
  } catch (error) {
    console.error('완료 항목 조회 실패:', error);
    console.error('에러 스택:', error.stack);
    return {
      success: false,
      message: error.toString(),
      items: []
    };
  }
}

// 간단한 연결 테스트
// P열 데이터 확인 함수
function checkPColumn(orderId) {
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      console.log('발주서 시트를 찾을 수 없습니다.');
      return;
    }
    
    const lastRow = sheet.getLastRow();
    console.log('전체 행 수:', lastRow);
    
    if (lastRow > 6) {
      const numRows = Math.min(20, lastRow - 6); // 최대 20개 행만 확인
      const data = sheet.getRange(7, 1, numRows, 17).getValues();
      
      console.log('P열 데이터 확인 (처음 20개):');
      for (let i = 0; i < data.length; i++) {
        const pColumn = data[i][15]; // P열 (16번째, 인덱스 15)
        if (pColumn || i < 5) { // P열에 값이 있거나 처음 5개는 무조건 출력
          console.log(`행 ${i+7}: A열(바코드)="${data[i][0]}", P열="${pColumn}", 타입=${typeof pColumn}`);
        }
      }
    }
  } catch (error) {
    console.error('테스트 실패:', error);
  }
}

// 중복 완료 항목 병합 함수
function mergeDuplicateCompletedItems(items) {
  const itemMap = new Map();
  
  items.forEach(item => {
    const key = item.barcode;
    
    if (itemMap.has(key)) {
      const existing = itemMap.get(key);
      
      // 박스번호 병합
      if (item.boxNumbers && item.boxNumbers.trim()) {
        if (existing.boxNumbers) {
          // 기존 박스번호와 병합
          const existingBoxes = parseBoxNumbers(existing.boxNumbers);
          const newBoxes = parseBoxNumbers(item.boxNumbers);
          
          // 박스번호별로 수량 합산
          newBoxes.forEach((qty, boxNum) => {
            existingBoxes.set(boxNum, (existingBoxes.get(boxNum) || 0) + qty);
          });
          
          // 다시 문자열로 변환
          existing.boxNumbers = Array.from(existingBoxes.entries())
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
            .map(([box, qty]) => `${box}(${qty})`)
            .join(', ');
        } else {
          existing.boxNumbers = item.boxNumbers;
        }
      }
      
      // 수량 합산
      existing.quantity += item.quantity;
      existing.originalQuantity += item.originalQuantity || 0;
      existing.scannedQuantity += item.scannedQuantity;
      
      // 행 인덱스 수집
      if (!existing.rowIndices) {
        existing.rowIndices = [existing.rowIndex];
      }
      existing.rowIndices.push(item.rowIndex);
      
    } else {
      // 새 항목 추가
      itemMap.set(key, {
        ...item,
        rowIndices: [item.rowIndex]
      });
    }
  });
  
  return Array.from(itemMap.values());
}

// 박스 패킹 임시저장 함수
function saveTemporaryPacking(orderId, packingData) {
  console.log('임시 패킹 데이터 저장:', orderId);
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    let packingSheet = ss.getSheetByName('패킹리스트');
    
    // 패킹리스트 시트가 없으면 생성
    if (!packingSheet) {
      packingSheet = ss.insertSheet('패킹리스트');
      
      // 헤더 설정
      const headers = ['바코드', '상품명', '옵션', '수량', '박스번호', '메모', '비고', '스캔시간', '임시저장', '작업자', '수정시간'];
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
      packingSheet.setColumnWidth(9, 80);  // 임시저장
      packingSheet.setColumnWidth(10, 150); // 작업자
      packingSheet.setColumnWidth(11, 150); // 수정시간
    }
    
    const userEmail = Session.getActiveUser().getEmail() || 'Unknown';
    const timestamp = new Date();
    
    // 기존 임시저장 데이터 삭제 (같은 사용자, 같은 박스)
    const lastRow = packingSheet.getLastRow();
    if (lastRow > 1) {
      const existingData = packingSheet.getRange(2, 1, lastRow - 1, 11).getValues();
      const rowsToDelete = [];
      
      for (let i = existingData.length - 1; i >= 0; i--) {
        // 같은 박스번호, 같은 작업자, 임시저장 상태인 행 찾기
        if (existingData[i][4] == packingData.boxNumber && 
            existingData[i][8] === 'Y' && 
            existingData[i][9] === userEmail) {
          rowsToDelete.push(i + 2);
        }
      }
      
      // 역순으로 삭제 (인덱스 변경 방지)
      rowsToDelete.forEach(row => {
        packingSheet.deleteRow(row);
      });
    }
    
    // 새로운 임시저장 데이터 추가
    const newRows = packingData.items.map(item => [
      item.barcode,
      item.name,
      item.option || '',
      item.scannedInThisBox,
      packingData.boxNumber,
      item.comment || '',
      item.stockAvailable || '',
      timestamp,
      'Y', // 임시저장 여부
      userEmail,
      timestamp
    ]);
    
    if (newRows.length > 0) {
      const startRow = packingSheet.getLastRow() + 1;
      packingSheet.getRange(startRow, 1, newRows.length, 11).setValues(newRows);
    }
    
    return {
      success: true,
      message: `${newRows.length}개 항목이 임시저장되었습니다.`
    };
    
  } catch (error) {
    console.error('임시저장 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 임시저장된 패킹 데이터 로드
function loadTemporaryPacking(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const packingSheet = ss.getSheetByName('패킹리스트');
    
    if (!packingSheet) {
      return { success: true, data: null };
    }
    
    const userEmail = Session.getActiveUser().getEmail() || 'Unknown';
    const lastRow = packingSheet.getLastRow();
    
    if (lastRow <= 1) {
      return { success: true, data: null };
    }
    
    const data = packingSheet.getRange(2, 1, lastRow - 1, 11).getValues();
    const tempItems = {};
    let tempBoxNumber = null;
    
    // 임시저장된 항목 찾기
    data.forEach(row => {
      if (row[8] === 'Y' && row[9] === userEmail) { // 임시저장이고 같은 사용자
        const barcode = row[0];
        const boxNumber = row[4];
        
        if (!tempBoxNumber) {
          tempBoxNumber = boxNumber;
        }
        
        if (!tempItems[barcode]) {
          tempItems[barcode] = {
            barcode: barcode,
            name: row[1],
            option: row[2],
            scannedInThisBox: 0,
            comment: row[5],
            stockAvailable: row[6]
          };
        }
        
        tempItems[barcode].scannedInThisBox += row[3];
      }
    });
    
    if (Object.keys(tempItems).length > 0) {
      return {
        success: true,
        data: {
          boxNumber: tempBoxNumber,
          items: tempItems
        }
      };
    }
    
    return { success: true, data: null };
    
  } catch (error) {
    console.error('임시저장 로드 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 임시 저장 데이터 삭제
function clearTemporaryPacking(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const packingSheet = ss.getSheetByName('패킹리스트');
    
    if (!packingSheet) {
      return { success: true };
    }
    
    const lastRow = packingSheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true };
    }
    
    const data = packingSheet.getRange(2, 1, lastRow - 1, 9).getValues();
    const userEmail = Session.getActiveUser().getEmail();
    
    // 현재 사용자의 임시 저장 데이터 찾아서 삭제
    for (let i = 0; i < data.length; i++) {
      if (data[i][6] === '임시저장' && data[i][7] === userEmail) {
        packingSheet.deleteRow(i + 2);
        break;
      }
    }
    
    return { success: true };
    
  } catch (error) {
    console.error('임시 데이터 삭제 오류:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 디버깅: CSV 내보내기 상태 확인
function debugExportStatus() {
  const orderId = '1eTIFbWZupx4BhX-PUmgXBNCx-l0BEsLG7GinlCGTNSA';
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      console.error('발주서 시트를 찾을 수 없습니다');
      return;
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 6) {
      console.log('데이터가 없습니다');
      return;
    }
    
    // A열(바코드), B열(상품명), N열(내보내기시간) 확인
    const data = sheet.getRange(7, 1, Math.min(20, lastRow - 6), 14).getValues();
    
    console.log('=== 내보내기 상태 확인 ===');
    data.forEach((row, index) => {
      if (row[0]) {
        console.log(`행 ${7 + index}:`);
        console.log(`  바코드: ${row[0]}`);
        console.log(`  상품명: ${row[1]}`);
        console.log(`  옵션: ${row[2]}`);
        console.log(`  내보내기시간(N열): "${row[13]}"`);
        console.log('---');
      }
    });
    
  } catch (error) {
    console.error('오류:', error);
  }
}

// 간단한 박스번호 확인 함수
function checkBoxNumbers(orderId) {
  if (!orderId) {
    orderId = '1eTIFbWZupx4BhX-PUmgXBNCx-l0BEsLG7GinlCGTNSA';
  }
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      console.error('발주서 시트를 찾을 수 없습니다');
      return;
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 6) {
      console.log('데이터가 없습니다');
      return;
    }
    
    // N열(내보내기시간), P열(박스번호), Q열(출고가능수량) 확인
    const data = sheet.getRange(7, 14, Math.min(10, lastRow - 6), 4).getValues();
    
    console.log('=== 내보내기된 항목 확인 (최대 10개) ===');
    data.forEach((row, index) => {
      if (row[0]) { // N열에 값이 있으면 (내보내기됨)
        console.log(`행 ${7 + index}:`);
        console.log(`  내보내기시간: ${row[0]}`);
        console.log(`  CSV확인: ${row[1]}`);
        console.log(`  박스번호: "${row[2]}"`);
        console.log(`  출고가능수량: ${row[3]}`);
      }
    });
    
  } catch (error) {
    console.error('오류:', error);
  }
}

// ===== 즉시 동기화 함수 =====
function performQuickSync() {
  console.log('=== 즉시 동기화 시작 ===');
  
  try {
    const results = {
      success: true,
      salesSync: null,
      dataUpdate: null
    };
    
    // 1. Sales_Recent 동기화
    console.log('1. Sales_Recent 동기화 중...');
    try {
      const salesResult = syncIncrementalToRecent();
      results.salesSync = salesResult;
      console.log('Sales 동기화 완료:', salesResult);
    } catch (e) {
      console.error('Sales 동기화 오류:', e);
      // 에러가 나도 계속 진행
    }
    
    // 2. SmaregiData 업데이트
    console.log('2. SmaregiData 업데이트 중...');
    try {
      const dataResult = updateIntegratedSmaregiData();
      results.dataUpdate = dataResult;
      console.log('SmaregiData 업데이트 완료:', dataResult);
    } catch (e) {
      console.error('SmaregiData 업데이트 오류:', e);
      // 에러가 나도 계속 진행
    }
    
    console.log('=== 즉시 동기화 완료 ===');
    return results;
    
  } catch (error) {
    console.error('즉시 동기화 전체 오류:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}
