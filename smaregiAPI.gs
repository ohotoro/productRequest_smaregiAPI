
/**
 * Platform API 설정 가져오기
 */
function getCurrentConfig() {
  return CONFIG.PLATFORM_CONFIG;
}

/**
 * 액세스 토큰 취득 (Client Credentials Grant)
 */
function getSmaregiAccessToken() {
  try {
    console.log('=== Smaregi 액세스 토큰 취득 ===');
    
    const config = getSmaregiConfig();
    
    // 캐시 확인 (cacheManager.gs의 함수 사용)
    const cached = getCache('smaregi_access_token');
    if (cached && cached.expires_at > new Date().getTime()) {
      console.log('캐시된 토큰 사용');
      return cached;
    }
    
    const url = `${config.TOKEN_URL}${config.CONTRACT_ID}/token`;
    const credentials = Utilities.base64Encode(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`);
    
    const payload = {
      grant_type: 'client_credentials',
      scope: config.SCOPES
    };
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: Object.keys(payload)
        .map(key => `${key}=${encodeURIComponent(payload[key])}`)
        .join('&'),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 200) {
      const tokenData = JSON.parse(response.getContentText());
      tokenData.expires_at = new Date().getTime() + (tokenData.expires_in * 1000) - 60000;
      
      // 캐시 저장 (cacheManager.gs의 함수 사용)
      setCache('smaregi_access_token', tokenData, tokenData.expires_in - 60);
      
      console.log('액세스 토큰 취득 성공');
      return tokenData;
    } else {
      console.error('토큰 취득 실패:', response.getContentText());
      return null;
    }
    
  } catch (error) {
    console.error('액세스 토큰 취득 에러:', error);
    return null;
  }
}

/**
 * Smaregi API 호출 (통합)
 */
function callSmaregiAPI(endpoint, method = 'GET', payload = null) {
  try {
    const tokenData = getSmaregiAccessToken();
    if (!tokenData) {
      return {
        success: false,
        message: '액세스 토큰 취득 실패'
      };
    }
    
    const config = getSmaregiConfig();
    const url = `${config.API_BASE_URL}${config.CONTRACT_ID}/${endpoint}`;
    
    const options = {
      method: method,
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true,
      timeout: config.TIMEOUT / 1000
    };
    
    if (payload) {
      options.payload = JSON.stringify(payload);
    }
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (statusCode >= 200 && statusCode < 300) {
      return {
        success: true,
        data: responseText ? JSON.parse(responseText) : null,
        statusCode: statusCode
      };
    } else {
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

/**
 * Smaregi 연결 테스트 (통합)
 */
function testSmaregiConnection() {
  try {
    console.log('=== Smaregi API 연결 테스트 ===');
    
    const result = callSmaregiAPI('pos/stores');
    
    if (result.success) {
      const stores = result.data || [];
      console.log(`연결 성공: ${stores.length}개 매장 확인`);
      
      return {
        success: true,
        message: 'Smaregi API 연결 성공',
        stores: stores.length,
        data: stores
      };
    } else {
      console.error(`연결 실패: ${result.statusCode}`);
      return {
        success: false,
        message: `연결 실패: HTTP ${result.statusCode}`,
        error: result.error
      };
    }
    
  } catch (error) {
    console.error('연결 테스트 실패:', error);
    return {
      success: false,
      message: '연결 테스트 실패',
      error: error.toString()
    };
  }
}

/**
 * 재고 데이터 조회 (통합)
 */
function getSmaregiStockData(storeId = null) {
  try {
    console.log('=== Smaregi 재고 데이터 조회 ===');
    
    // 캐시 확인
    const cacheKey = `smaregi_stock_${storeId || 'all'}`;
    const cached = getCache(cacheKey);
    if (cached) {
      console.log('캐시된 재고 데이터 반환');
      return cached;
    }
    
    // 매장 ID 확인
    if (!storeId) {
      const stores = getSmaregiStores();
      if (stores.length > 0) {
        storeId = stores[0].storeId;
      } else {
        return { success: false, message: '매장 정보를 찾을 수 없습니다.' };
      }
    }
    
    const stockData = {};
    let page = 1;
    const limit = 1000;
    
    // 페이징 처리
    while (true) {
      const endpoint = `pos/stocks?storeId=${storeId}&limit=${limit}&page=${page}`;
      const result = callSmaregiAPI(endpoint);
      
      if (!result.success) {
        console.error('재고 조회 실패:', result.error);
        break;
      }
      
      const items = result.data;
      if (!items || items.length === 0) {
        break;
      }
      
      // 재고 데이터 처리
      items.forEach(item => {
        if (item.productCode) {
          stockData[item.productCode] = {
            quantity: item.stockAmount || 0,
            productId: item.productId,
            productName: item.productName,
            updatedAt: item.updatedDateTime
          };
        }
      });
      
      if (items.length < limit) {
        break;
      }
      page++;
    }
    
    console.log(`${Object.keys(stockData).length}개 재고 데이터 조회 완료`);
    
    // 캐시 저장 (15분)
    const result = {
      success: true,
      data: stockData,
      count: Object.keys(stockData).length,
      storeId: storeId,
      timestamp: new Date().toISOString()
    };
    
    setCache(cacheKey, result, CACHE_DURATION.SHORT * 3);
    
    return result;
    
  } catch (error) {
    console.error('재고 데이터 조회 에러:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 매장 목록 조회
 */
function getSmaregiStores() {
  try {
    const cached = getCache('smaregi_stores');
    if (cached) return cached;
    
    const result = callSmaregiAPI('pos/stores');
    
    if (result.success) {
      const stores = result.data || [];
      setCache('smaregi_stores', stores, CACHE_DURATION.LONG);
      return stores;
    }
    
    return [];
    
  } catch (error) {
    console.error('매장 목록 조회 실패:', error);
    return [];
  }
}

/**
 * 특정 바코드 재고 조회
 */
function getSmaregiStockByBarcode(barcode, storeId = null) {
  try {
    // 전체 재고에서 찾기
    const stockData = getSmaregiStockData(storeId);
    
    if (stockData.success && stockData.data[barcode]) {
      return {
        success: true,
        barcode: barcode,
        stock: stockData.data[barcode].quantity,
        productName: stockData.data[barcode].productName,
        updatedAt: stockData.data[barcode].updatedAt
      };
    }
    
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      message: '재고 정보를 찾을 수 없습니다.'
    };
    
  } catch (error) {
    console.error('개별 재고 조회 실패:', error);
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      error: error.toString()
    };
  }
}

/**
 * Smaregi 연결 상태 확인
 */
function isSmaregiAvailable() {
  const cacheKey = 'smaregi_available';
  const cached = getCache(cacheKey);
  
  if (cached !== null) {
    return cached;
  }
  
  const result = testSmaregiConnection();
  const isAvailable = result.success;
  
  setCache(cacheKey, isAvailable, CACHE_DURATION.SHORT);
  
  return isAvailable;
}

/**
 * 재고 부족 상품 조회
 */
function getSmaregiLowStockItems(threshold = 10, storeId = null) {
  try {
    const stockData = getSmaregiStockData(storeId);
    
    if (!stockData.success) {
      return [];
    }
    
    const lowStockItems = [];
    
    Object.entries(stockData.data).forEach(([barcode, data]) => {
      if (data.quantity < threshold) {
        lowStockItems.push({
          barcode: barcode,
          productName: data.productName,
          currentStock: data.quantity,
          lastUpdate: data.updatedAt
        });
      }
    });
    
    // 재고 적은 순으로 정렬
    return lowStockItems
      .sort((a, b) => a.currentStock - b.currentStock)
      .slice(0, 100);
    
  } catch (error) {
    console.error('재고 부족 상품 조회 실패:', error);
    return [];
  }
}
