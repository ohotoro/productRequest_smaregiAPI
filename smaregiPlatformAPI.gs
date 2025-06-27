// smaregiPlatformAPI.gs 수정 - 재고 데이터 가져오기 (await 제거 버전)
function getPlatformStockData(storeId = null) {
  try {
    console.log('=== プラットフォームAPI 在庫データ取得 ===');
    
    const stockData = {};
    let page = 1;
    const limit = 1000;
    
    // 店舗ID取得
    if (!storeId) {
      const stores = getPlatformStores();
      if (stores.length > 0) {
        storeId = stores[0].storeId;
        console.log('デフォルト店舗ID:', storeId);
      } else {
        return { success: false, message: '店舗情報が見つかりません' };
      }
    }
    
    // ページング処理
    while (true) {
      // 正しいエンドポイントとパラメータ形式を使用
      const endpoint = `pos/stock?store_id=${storeId}&limit=${limit}&page=${page}`;
      const result = callPlatformAPI(endpoint);
      
      if (!result.success) {
        console.error('在庫取得失敗:', result.error);
        break;
      }
      
      const items = result.data;
      if (!items || items.length === 0) {
        break;
      }
      
      // 在庫データ処理 - productId を productCode にマッピング
      items.forEach(item => {
        // productId から商品情報を取得してバーコードを特定
        const productCode = getProductCodeById(item.productId);
        
        if (productCode) {
          stockData[productCode] = {
            quantity: parseInt(item.stockAmount) || 0,
            layawayQuantity: parseInt(item.layawayStockAmount) || 0,
            availableQuantity: parseInt(item.stockAmount) - parseInt(item.layawayStockAmount),
            productId: item.productId,
            storeId: item.storeId,
            updatedAt: item.updDateTime
          };
        }
      });
      
      console.log(`ページ ${page}: ${items.length}件処理`);
      
      if (items.length < limit) {
        break;
      }
      page++;
    }
    
    console.log(`${Object.keys(stockData).length}個の在庫データ取得完了`);
    
    return {
      success: true,
      data: stockData,
      count: Object.keys(stockData).length,
      storeId: storeId,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('在庫データ取得エラー:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// ===== smaregiPlatformAPI.gs - 필수 함수들 =====

// getCurrentConfig 함수 - Platform API 설정 가져오기
function getCurrentConfig() {
  if (!CONFIG || !CONFIG.PLATFORM_CONFIG) {
    console.error('PLATFORM_CONFIG가 설정되지 않았습니다');
    throw new Error('PLATFORM_CONFIG が設定されていません');
  }
  
  const config = CONFIG.PLATFORM_CONFIG;
  const isProduction = config.USE_PRODUCTION;
  
  return {
    CONTRACT_ID: isProduction ? config.PROD_CONTRACT_ID : config.DEV_CONTRACT_ID,
    CLIENT_ID: isProduction ? config.PROD_CLIENT_ID : config.DEV_CLIENT_ID,
    CLIENT_SECRET: isProduction ? config.PROD_CLIENT_SECRET : config.DEV_CLIENT_SECRET,
    TOKEN_URL: isProduction ? config.PROD_TOKEN_URL : config.DEV_TOKEN_URL,
    API_BASE_URL: isProduction ? config.PROD_API_BASE_URL : config.DEV_API_BASE_URL,
    SCOPES: config.SCOPES,
    ENVIRONMENT: isProduction ? '本番環境' : '開発環境'
  };
}

// getPlatformAccessToken 함수 완전 교체
function getPlatformAccessToken() {
  try {
    console.log('=== Platform API 토큰 취득 시작 ===');
    
    const config = getCurrentConfig();
    console.log(`환경: ${config.ENVIRONMENT}`);
    
    if (!config.CLIENT_ID || !config.CLIENT_SECRET) {
      console.error('CLIENT_ID 또는 CLIENT_SECRET가 설정되지 않았습니다');
      return null;
    }
    
    // 캐시 확인
    const cache = CacheService.getScriptCache();
    const cachedToken = cache.get('platform_access_token');
    
    if (cachedToken) {
      try {
        const tokenData = JSON.parse(cachedToken);
        if (tokenData.expires_at > new Date().getTime()) {
          console.log('캐시된 토큰 사용');
          return tokenData;
        }
      } catch (e) {
        // 캐시 파싱 실패시 무시
      }
    }
    
    // 토큰 URL 수정 - CONTRACT_ID 포함
    const url = `${config.TOKEN_URL}${config.CONTRACT_ID}/token`;
    console.log('토큰 요청 URL:', url);
    
    // Basic Authentication 생성
    const credentials = Utilities.base64Encode(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`);
    
    const formData = {
      'grant_type': 'client_credentials',
      'scope': config.SCOPES
    };
    
    const payload = Object.keys(formData)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(formData[key])}`)
      .join('&');
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: payload,
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log('토큰 응답 상태:', statusCode);
    
    if (statusCode === 200) {
      const tokenData = JSON.parse(responseText);
      
      // 유효기간 계산 (통상 1시간)
      tokenData.expires_at = new Date().getTime() + (tokenData.expires_in * 1000) - 60000;
      
      // 캐시 저장 - JSON 문자열로 저장
      const cacheTime = Math.min(tokenData.expires_in - 60, 21600);
      cache.put('platform_access_token', JSON.stringify(tokenData), cacheTime);
      
      console.log('토큰 취득 성공');
      console.log('스코프:', tokenData.scope);
      
      return tokenData;
      
    } else {
      console.error('토큰 취득 실패:', responseText);
      return null;
    }
    
  } catch (error) {
    console.error('Platform API 토큰 취득 실패:', error);
    return null;
  }
}

// callPlatformAPI 함수 수정
function callPlatformAPI(endpoint, method = 'GET', payload = null) {
  try {
    const tokenData = getPlatformAccessToken();
    if (!tokenData || !tokenData.access_token) {
      console.error('액세스 토큰 없음');
      return {
        success: false,
        message: '액세스 토큰 취득 실패'
      };
    }
    
    const config = getCurrentConfig();
    const url = `${config.API_BASE_URL}${config.CONTRACT_ID}/${endpoint}`;
    
    console.log('API 호출:', url);
    
    const options = {
      method: method,
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    };
    
    if (payload) {
      options.payload = JSON.stringify(payload);
    }
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log(`API 응답: ${statusCode}`);
    
    if (statusCode >= 200 && statusCode < 300) {
      return {
        success: true,
        data: responseText ? JSON.parse(responseText) : null,
        statusCode: statusCode
      };
    } else {
      console.error('API 오류:', responseText);
      return {
        success: false,
        statusCode: statusCode,
        error: responseText
      };
    }
    
  } catch (error) {
    console.error('API 호출 에러:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// getPlatformStores 함수 - 매장 목록 조회
function getPlatformStores() {
  try {
    const result = callPlatformAPI('pos/stores');
    
    if (result.success) {
      return result.data || [];
    }
    
    return [];
    
  } catch (error) {
    console.error('店舗一覧取得エラー:', error);
    return [];
  }
}

// testPlatformConnection 함수 - 연결 테스트
function testPlatformConnection() {
  try {
    console.log('=== Platform API 연결 테스트 ===');
    
    // 토큰 발급 테스트
    const tokenData = getPlatformAccessToken();
    
    if (!tokenData) {
      return {
        success: false,
        message: '토큰 발급 실패'
      };
    }
    
    console.log('토큰 스코프:', tokenData.scope);
    
    // 매장 조회로 연결 확인
    const result = callPlatformAPI('pos/stores');
    
    if (result.success) {
      console.log(`✅ 연결 성공: ${result.data.length}개 매장`);
      return {
        success: true,
        message: 'Platform API 연결 성공',
        stores: result.data.length,
        data: result.data
      };
    } else {
      console.error('❌ API 호출 실패:', result.error);
      return {
        success: false,
        message: `API 호출 실패: ${result.statusCode}`,
        error: result.error
      };
    }
    
  } catch (error) {
    console.error('Platform API 테스트 실패:', error);
    return {
      success: false,
      message: '연결 테스트 실패',
      error: error.toString()
    };
  }
}

// getPlatformStockDataOptimized 자리에 이 함수 추가
function getPlatformStockDataOptimized(storeId = null) {
  try {
    console.log('=== 재고 데이터 조회 (간단 버전) ===');
    
    const cacheKey = `stock_simple_${storeId || 'all'}`;
    const cached = getCache(cacheKey);
    if (cached) {
      console.log('캐시된 재고 데이터 사용');
      return cached;
    }
    
    if (!storeId) {
      const stores = getPlatformStores();
      if (stores && stores.length > 0) {
        storeId = stores[0].storeId;
      }
    }
    
    const stockMap = {};
    let page = 1;
    const limit = 1000;
    
    // 재고 데이터 직접 조회 (바코드를 productCode로 사용)
    while (page <= 3) { // 최대 3페이지만
      const endpoint = `pos/stock?store_id=${storeId}&limit=${limit}&page=${page}`;
      const result = callPlatformAPI(endpoint);
      
      if (!result.success || !result.data || result.data.length === 0) {
        break;
      }
      
      // productCode를 바코드로 직접 사용하는 간단한 방식
      result.data.forEach(stock => {
        // productId가 우리 바코드 형식(10자리)이면 직접 사용
        if (/^\d{10}$/.test(stock.productId)) {
          stockMap[stock.productId] = {
            quantity: parseInt(stock.stockAmount) || 0,
            layawayQuantity: parseInt(stock.layawayStockAmount) || 0,
            availableQuantity: (parseInt(stock.stockAmount) || 0) - (parseInt(stock.layawayStockAmount) || 0),
            storeId: stock.storeId,
            updatedAt: stock.updDateTime
          };
        }
      });
      
      if (result.data.length < limit) break;
      page++;
    }
    
    console.log(`${Object.keys(stockMap).length}개 재고 데이터 수집`);
    
    const resultData = {
      success: true,
      data: stockMap,
      count: Object.keys(stockMap).length,
      storeId: storeId,
      timestamp: new Date().toISOString()
    };
    
    setCache(cacheKey, resultData, 1800);
    return resultData;
    
  } catch (error) {
    console.error('재고 조회 실패:', error);
    return { success: false, error: error.toString() };
  }
}

// 캐시 무효화 함수 추가
function invalidatePlatformCache() {
  try {
    const cache = CacheService.getScriptCache();
    cache.removeAll(['all_products_map', 'platform_stock_data_all']);
    console.log('Platform API 캐시 무효화 완료');
    return {
      success: true,
      message: '캐시가 초기화되었습니다.'
    };
  } catch (error) {
    console.error('캐시 무효화 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// 特定バーコードの在庫を取得
function getPlatformStockByBarcode(barcode, storeId = null) {
  try {
    // まず商品情報を取得
    const productResult = callPlatformAPI(`pos/products?limit=1&product_code=${barcode}`);
    
    if (!productResult.success || !productResult.data || productResult.data.length === 0) {
      return {
        success: false,
        message: '商品が見つかりません',
        stock: 0
      };
    }
    
    const product = productResult.data[0];
    const productId = product.productId;
    
    // 在庫を取得
    let endpoint = `pos/stock?product_id=${productId}`;
    if (storeId) {
      endpoint += `&store_id=${storeId}`;
    }
    
    const stockResult = callPlatformAPI(endpoint);
    
    if (stockResult.success && stockResult.data && stockResult.data.length > 0) {
      const stockInfo = stockResult.data[0];
      
      return {
        success: true,
        barcode: barcode,
        stock: parseInt(stockInfo.stockAmount) || 0,
        layawayStock: parseInt(stockInfo.layawayStockAmount) || 0,
        availableStock: parseInt(stockInfo.stockAmount) - parseInt(stockInfo.layawayStockAmount),
        productName: product.productName,
        storeId: stockInfo.storeId,
        updatedAt: stockInfo.updDateTime
      };
    }
    
    return {
      success: true,
      barcode: barcode,
      stock: 0,
      message: '在庫情報がありません'
    };
    
  } catch (error) {
    console.error('バーコード在庫取得エラー:', error);
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      error: error.toString()
    };
  }
}

// テスト関数
function testNewStockAPI() {
  console.log('=== 新しい在庫API テスト ===');
  
  // 1. 全体在庫取得テスト
  console.log('\n1. 最適化版在庫取得テスト');
  const stockResult = getPlatformStockDataOptimized();
  
  if (stockResult.success) {
    console.log(`✅ 成功: ${stockResult.count}個の在庫データ`);
    
    // サンプル表示
    const samples = Object.entries(stockResult.data).slice(0, 3);
    samples.forEach(([code, data]) => {
      console.log(`\nバーコード: ${code}`);
      console.log(`商品名: ${data.productName}`);
      console.log(`在庫数: ${data.quantity}`);
      console.log(`予約数: ${data.layawayQuantity}`);
      console.log(`利用可能数: ${data.availableQuantity}`);
    });
  } else {
    console.error('❌ 失敗:', stockResult.error);
  }
  
  // 2. 個別在庫取得テスト
  console.log('\n2. バーコード個別在庫テスト');
  const testBarcode = '1000008038';
  const individualResult = getPlatformStockByBarcode(testBarcode);
  
  if (individualResult.success) {
    console.log(`✅ バーコード ${testBarcode} の在庫:`, individualResult.stock);
  } else {
    console.error('❌ 失敗:', individualResult.message);
  }
}

// Smaregi 재고 데이터 가져오기 - 웹앱에서 사용
function getSmaregiStockData() {
  try {
    // 플랫폼 API 사용
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API로 재고 조회');
        const result = getPlatformStockDataOptimized();
        
        if (result.success) {
          return {
            success: true,
            data: result.data,
            count: result.count,
            storeId: result.storeId,
            source: 'platform'
          };
        }
      }
    }
    
    // Legacy API fallback
    console.log('Platform API 재고 조회 실패');
    return {
      success: false,
      message: 'Platform API 재고 조회 실패'
    };
    
  } catch (error) {
    console.error('재고 데이터 조회 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// 재고 조회 - 바코드별
function getSmaregiStockByBarcode(barcode) {
  try {
    // Platform API 사용
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      return getPlatformStockByBarcode(barcode);
    }
    
    // Legacy fallback
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      message: 'API 연결 실패'
    };
    
  } catch (error) {
    console.error('바코드 재고 조회 실패:', error);
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      error: error.toString()
    };
  }
}

/**
 * Smaregi API 연결 재설정
 * @returns {Object} 재연결 결과
 */
function resetSmaregiConnection() {
  try {
    console.log('=== Smaregi API 재연결 시작 ===');
    
    // 1. 캐시 초기화
    clearAllSmaregiCache();
    
    // 2. 토큰 재발급
    const cache = CacheService.getScriptCache();
    cache.remove('platform_access_token');
    
    // 3. 연결 테스트
    const connectionResult = checkSmaregiConnection();
    
    if (connectionResult.connected) {
      console.log('✅ API 재연결 성공');
      
      // 4. 초기 데이터 로드 (선택사항)
      const stockResult = getSmaregiStockData();
      
      return {
        success: true,
        message: 'API 연결이 복구되었습니다.',
        connected: true,
        apiType: connectionResult.apiType,
        itemCount: stockResult.success ? stockResult.count : 0
      };
    } else {
      console.error('❌ API 재연결 실패');
      return {
        success: false,
        message: 'API 연결 실패. 설정을 확인해주세요.',
        connected: false,
        error: connectionResult.error
      };
    }
    
  } catch (error) {
    console.error('재연결 중 오류:', error);
    return {
      success: false,
      message: '재연결 중 오류가 발생했습니다.',
      connected: false,
      error: error.toString()
    };
  }
}

/**
 * 모든 Smaregi 관련 캐시 삭제
 */
function clearAllSmaregiCache() {
  try {
    const cache = CacheService.getScriptCache();
    
    // 삭제할 캐시 키들
    const cacheKeys = [
      'platform_access_token',
      'all_products_map',
      'platform_stock_data',
      'smaregi_stores',
      'smaregi_available',
      'smaregi_stock_all'
    ];
    
    // 추가로 패턴에 맞는 캐시도 삭제
    const patterns = [
      'smaregi_stock_',
      'product_',
      'sales_data_'
    ];
    
    // 개별 키 삭제
    cacheKeys.forEach(key => {
      try {
        cache.remove(key);
        console.log(`캐시 삭제: ${key}`);
      } catch (e) {
        // 캐시 키가 없어도 무시
      }
    });
    
    console.log('✅ 모든 Smaregi 캐시 삭제 완료');
    
  } catch (error) {
    console.error('캐시 삭제 실패:', error);
  }
}

// smaregiPlatformAPI.gs - 완전한 판매 데이터 조회 함수
function getPlatformSalesDataComplete(days = 30) {
  try {
    console.log(`=== 최근 ${days}일 판매 데이터 조회 (완전판) ===`);
    
    const stores = getPlatformStores();
    if (!stores || stores.length === 0) {
      console.log('매장 정보를 가져올 수 없습니다');
      return { success: false, message: '매장 정보 없음' };
    }
    
    const storeId = stores[0].storeId;
    console.log(`매장 ID: ${storeId}`);
    
    // ISO 8601 날짜 설정
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const dateFrom = Utilities.formatDate(startDate, 'GMT+9', "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
    const dateTo = Utilities.formatDate(endDate, 'GMT+9', "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
    
    console.log(`조회 기간: ${dateFrom} ~ ${dateTo}`);
    
    // 전체 상품 맵 가져오기
    const productMap = getAllProductsMap();
    console.log(`상품 맵: ${Object.keys(productMap).length}개`);
    
    // 판매 데이터 수집
    const salesMap = {};
    let page = 1;
    const limit = 100; // 한 번에 100개씩 처리
    let totalTransactions = 0;
    let processedTransactions = 0;
    
    while (true) {
      // 거래 목록 조회
      const params = [
        `store_id=${storeId}`,
        `transaction_date_time-from=${encodeURIComponent(dateFrom)}`,
        `transaction_date_time-to=${encodeURIComponent(dateTo)}`,
        `limit=${limit}`,
        `page=${page}`
      ].join('&');
      
      const endpoint = `pos/transactions?${params}`;
      console.log(`거래 목록 조회 (페이지 ${page})`);
      
      const result = callPlatformAPI(endpoint);
      
      if (!result.success) {
        console.log('거래 조회 실패:', result.error);
        break;
      }
      
      const transactions = result.data;
      if (!transactions || transactions.length === 0) {
        console.log('더 이상 거래가 없습니다');
        break;
      }
      
      console.log(`페이지 ${page}: ${transactions.length}개 거래 발견`);
      
      // 각 거래의 상세 정보 조회 (배치 처리)
      for (let i = 0; i < transactions.length; i++) {
        const transaction = transactions[i];
        
        try {
          // 거래 상세 조회 (transactionHeadId 사용)
          const detailEndpoint = `pos/transactions/${transaction.transactionHeadId}/details`;
          const detailResult = callPlatformAPI(detailEndpoint);
          
          if (detailResult.success && detailResult.data) {
            // 각 상품별 판매 데이터 집계
            detailResult.data.forEach(detail => {
              const productCode = detail.productCode;
              const productName = productMap[productCode]?.productName || detail.productName || '상품명 없음';
              const quantity = detail.quantity || 0;
              const price = detail.unitTransactionPrice || 0;
              const subtotal = detail.subtotal || 0;
              
              if (!salesMap[productCode]) {
                salesMap[productCode] = {
                  productCode: productCode,
                  productName: productName,
                  quantity: 0,
                  amount: 0,
                  transactions: [],
                  trend: 'stable'
                };
              }
              
              salesMap[productCode].quantity += quantity;
              salesMap[productCode].amount += subtotal;
              salesMap[productCode].transactions.push({
                date: transaction.transactionDateTime,
                quantity: quantity,
                price: price
              });
              
              // 가장 최근 판매일
              if (!salesMap[productCode].lastSale || 
                  new Date(transaction.transactionDateTime) > new Date(salesMap[productCode].lastSale)) {
                salesMap[productCode].lastSale = transaction.transactionDateTime;
              }
            });
          }
          
          processedTransactions++;
        } catch (error) {
          console.error(`거래 ${transaction.transactionId} 처리 중 오류:`, error);
          continue;
        }
        
        // 진행상황 표시 (10개마다)
        if ((i + 1) % 10 === 0) {
          console.log(`  - ${i + 1}/${transactions.length} 거래 처리 완료`);
        }
      }
      
      totalTransactions += transactions.length;
      console.log(`페이지 ${page} 완료: ${processedTransactions}개 거래 처리됨`);
      
      if (transactions.length < limit) {
        break;
      }
      
      page++;
      
      // 최대 5페이지까지만 처리 (500개 거래)
      if (page > 5) {
        console.log('최대 페이지 도달 (5페이지)');
        break;
      }
    }
    
    // 추세 분석
    Object.keys(salesMap).forEach(productCode => {
      const salesData = salesMap[productCode];
      if (salesData.transactions.length > 0) {
        salesData.trend = analyzeSalesTrend(salesData.transactions, days);
      }
    });
    
    console.log(`총 ${processedTransactions}개 거래에서 ${Object.keys(salesMap).length}개 상품의 판매 데이터 수집`);
    
    // 캐시 저장 (30분)
    const cacheKey = `sales_data_${days}_${storeId}`;
    setCache(cacheKey, salesMap, 1800);
    
    return {
      success: true,
      data: salesMap,
      count: Object.keys(salesMap).length,
      totalTransactions: processedTransactions,
      period: { from: dateFrom, to: dateTo }
    };
    
  } catch (error) {
    console.error('판매 데이터 조회 실패:', error);
    return {
      success: false,
      error: error.toString(),
      message: '판매 데이터 조회 중 오류가 발생했습니다'
    };
  }
}

// 간단한 판매 데이터 조회 함수 (개선 버전)
function getSimpleSalesDataV2(days = 30) {
  try {
    console.log(`=== 최근 ${days}일 판매 데이터 조회 (간단 버전 v2) ===`);
    
    // API 연결 확인
    if (!isSmaregiAvailable()) {
      console.log('Smaregi API 미연결');
      return { success: false, message: 'API 미연결' };
    }
    
    const stores = getPlatformStores();
    if (!stores || stores.length === 0) {
      return { success: false, message: '매장 정보 없음' };
    }
    
    const storeId = stores[0].storeId;
    
    // 날짜 설정
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const dateFrom = Utilities.formatDate(startDate, 'GMT+9', "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
    const dateTo = Utilities.formatDate(endDate, 'GMT+9', "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
    
    console.log(`조회 기간: ${dateFrom} ~ ${dateTo}`);
    
    // 캐시 확인
    const cacheKey = `sales_simple_v2_${days}_${storeId}`;
    const cached = getCache(cacheKey);
    if (cached) {
      console.log('캐시된 판매 데이터 사용');
      return {
        success: true,
        data: cached.data,
        count: cached.count,
        cached: true
      };
    }
    
    // 판매 데이터 맵
    const salesMap = {};
    let page = 1;
    const limit = 100;
    let totalTransactions = 0;
    let hasData = true;
    
    // 최대 3페이지 (300개 거래)까지만 조회
    while (page <= 3 && hasData) {
      const params = [
        `store_id=${storeId}`,
        `transaction_date_time-from=${encodeURIComponent(dateFrom)}`,
        `transaction_date_time-to=${encodeURIComponent(dateTo)}`,
        `limit=${limit}`,
        `page=${page}`
      ].join('&');
      
      const endpoint = `pos/transactions?${params}`;
      const result = callPlatformAPI(endpoint);
      
      if (!result.success || !result.data || result.data.length === 0) {
        hasData = false;
        break;
      }
      
      // 각 거래에 대해 상세 정보 조회
      for (const transaction of result.data) {
        // 거래 ID 찾기 (Smaregi는 transactionHeadId 사용)
        const transId = transaction.transactionHeadId || 
                       transaction.id || 
                       transaction.transaction_id;
        
        if (!transId) {
          console.log('거래 ID를 찾을 수 없습니다:', transaction);
          continue;
        }
        
        try {
          // 거래 상세 조회
          const detailEndpoint = `pos/transactions/${transId}/details`;
          const detailResult = callPlatformAPI(detailEndpoint);
          
          if (detailResult.success && detailResult.data) {
            // 각 상품별 판매 데이터 집계
            detailResult.data.forEach(detail => {
              const productCode = detail.productCode || detail.product_code;
              if (!productCode) return;
              
              if (!salesMap[productCode]) {
                salesMap[productCode] = {
                  productCode: productCode,
                  productName: detail.productName || detail.product_name || '상품명 없음',
                  quantity: 0,
                  amount: 0,
                  transactions: 0
                };
              }
              
              salesMap[productCode].quantity += parseInt(detail.quantity || 0);
              salesMap[productCode].amount += parseFloat(detail.subtotal || detail.price || 0);
              salesMap[productCode].transactions += 1;
            });
          }
        } catch (error) {
          console.error(`거래 ${transId} 상세 조회 실패:`, error);
        }
      }
      
      totalTransactions += result.data.length;
      console.log(`페이지 ${page}: ${result.data.length}개 거래 처리`);
      
      if (result.data.length < limit) {
        hasData = false;
      }
      
      page++;
    }
    
    console.log(`총 ${totalTransactions}개 거래에서 ${Object.keys(salesMap).length}개 상품 판매 데이터 수집`);
    
    // 결과 캐싱
    const resultData = {
      data: salesMap,
      count: Object.keys(salesMap).length
    };
    
    setCache(cacheKey, resultData, 1800); // 30분
    
    return {
      success: true,
      data: salesMap,
      count: Object.keys(salesMap).length,
      totalTransactions: totalTransactions
    };
    
  } catch (error) {
    console.error('간단한 판매 데이터 조회 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// ===== 캐시 완전 클리어 및 테스트 =====

function clearAllSalesCacheAndTest() {
  try {
    console.log('=== 모든 판매 캐시 클리어 및 재테스트 ===');
    
    // 1. 모든 판매 관련 캐시 삭제
    const cache = CacheService.getScriptCache();
    const keysToRemove = [];
    
    // 가능한 모든 캐시 키 패턴
    for (let days = 1; days <= 60; days++) {
      keysToRemove.push(`sales_simple_v2_${days}_1`);
      keysToRemove.push(`sales_batch_direct_${days}_*`);
    }
    
    // 캐시 삭제 (최대 30개씩)
    for (let i = 0; i < keysToRemove.length; i += 30) {
      const batch = keysToRemove.slice(i, i + 30);
      try {
        cache.removeAll(batch);
      } catch (e) {
        // 무시
      }
    }
    
    console.log('모든 판매 캐시 삭제 완료');
    
    // 2. 짧은 대기
    Utilities.sleep(1000);
    
    // 3. 실제 판매 상품으로 새로 테스트
    console.log('\n=== 1000027459 테스트 (캐시 없이) ===');
    const result1 = getProductSalesData('1000027459');
    console.log('결과:', JSON.stringify(result1, null, 2));
    
    console.log('\n=== 1000027572 테스트 (캐시 없이) ===');
    const result2 = getProductSalesData('1000027572');
    console.log('결과:', JSON.stringify(result2, null, 2));
    
    // 4. getBatchSalesData 직접 테스트
    console.log('\n=== getBatchSalesData 직접 테스트 ===');
    const batchResult30 = getBatchSalesData(['1000027459', '1000027572'], 30);
    console.log('30일 배치 결과:', JSON.stringify(batchResult30, null, 2));
    
    const batchResult10 = getBatchSalesData(['1000027459', '1000027572'], 10);
    console.log('10일 배치 결과:', JSON.stringify(batchResult10, null, 2));
    
    return {
      individual: {
        product1: result1,
        product2: result2
      },
      batch: {
        days30: batchResult30,
        days10: batchResult10
      }
    };
    
  } catch (error) {
    console.error('테스트 실패:', error);
    return { error: error.toString() };
  }
}
