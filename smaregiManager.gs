// ===== smaregiManager.gs - Smaregi API 통합 관리자 =====

/**
 * Smaregi 데이터 초기화 (API 연결)
 * @returns {Object} 초기화 결과
 */
function initializeSmaregiConnection() {
  try {
    console.log('=== Smaregi API 초기화 시작 ===');
    
    // 1. 연결 테스트
    const connectionTest = testSmaregiConnection();
    if (!connectionTest.success) {
      return {
        success: false,
        message: 'Smaregi API 연결 실패',
        error: connectionTest.error
      };
    }
    
    // 2. 초기 데이터 로드
    const stockData = getSmaregiStockData();
    if (!stockData.success) {
      return {
        success: false,
        message: '재고 데이터 로드 실패',
        error: stockData.error
      };
    }
    
    // 3. 설정 저장
    const scriptProps = PropertiesService.getScriptProperties();
    scriptProps.setProperty('SMAREGI_CONNECTED', 'true');
    scriptProps.setProperty('SMAREGI_LAST_SYNC', new Date().toISOString());
    
    console.log(`초기화 완료: ${stockData.count}개 상품`);
    
    return {
      success: true,
      message: 'Smaregi API 연결 성공',
      itemCount: stockData.count,
      storeId: stockData.storeId
    };
    
  } catch (error) {
    console.error('Smaregi 초기화 실패:', error);
    return {
      success: false,
      message: '초기화 중 오류 발생',
      error: error.toString()
    };
  }
}

/**
 * 실시간 재고 조회 (API)
 * @param {string} barcode - 바코드
 * @returns {Object} 재고 정보
 */
function getRealtimeStock(barcode) {
  try {
    // API 사용 가능 여부 확인
    if (!isSmaregiAvailable()) {
      return {
        success: false,
        message: 'Smaregi API 연결 불가',
        stock: 0
      };
    }
    
    // 재고 조회
    const stockInfo = getSmaregiStockByBarcode(barcode);
    
    return {
      success: stockInfo.success,
      barcode: barcode,
      stock: stockInfo.stock || 0,
      productName: stockInfo.productName,
      lastUpdate: stockInfo.updatedAt || new Date().toISOString(),
      source: 'api'
    };
    
  } catch (error) {
    console.error('실시간 재고 조회 실패:', error);
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      error: error.toString()
    };
  }
}

/**
 * 재고 부족 상품 자동 감지
 * @returns {Object} 재고 부족 상품 정보
 */
function detectLowStockItems() {
  try {
    const settings = getSettings();
    const threshold = parseInt(settings.suggestStock10) || 10;
    
    // API에서 재고 부족 상품 조회
    const lowStockItems = getSmaregiLowStockItems(threshold);
    
    if (lowStockItems.length === 0) {
      return {
        success: true,
        items: [],
        message: '재고 부족 상품이 없습니다.'
      };
    }
    
    // 발주 제안 추가
    const suggestions = generateSmaregiOrderSuggestions({
      threshold: threshold,
      limit: 100
    });
    
    return {
      success: true,
      items: suggestions,
      count: suggestions.length,
      threshold: threshold,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('재고 부족 감지 실패:', error);
    return {
      success: false,
      items: [],
      error: error.toString()
    };
  }
}

/**
 * 발주서에 재고 정보 자동 업데이트
 * @param {string} orderId - 발주서 ID
 * @returns {Object} 업데이트 결과
 */
function updateOrderWithSmaregiData(orderId) {
  try {
    console.log('=== 발주서 재고 정보 업데이트 시작 ===');
    
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서를 찾을 수 없습니다.' };
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 7) {
      return { success: false, message: '발주 항목이 없습니다.' };
    }
    
    // 전체 재고 데이터 로드
    const stockData = getSmaregiStockData();
    if (!stockData.success) {
      return { success: false, message: '재고 데이터 로드 실패' };
    }
    
    // 발주서 데이터 읽기
    const dataRange = sheet.getRange(7, 1, lastRow - 6, 13);
    const values = dataRange.getValues();
    
    let updatedCount = 0;
    const updates = [];
    
    // 각 항목의 재고 확인
    for (let i = 0; i < values.length; i++) {
      const barcode = String(values[i][0]);
      if (barcode && stockData.data[barcode]) {
        const stock = stockData.data[barcode].quantity;
        const stockStatus = stock > 0 ? STOCK_STATUS.AVAILABLE : STOCK_STATUS.UNAVAILABLE;
        
        // 재고 상태 업데이트 (L열)
        values[i][11] = stockStatus;
        
        // 메모에 재고 수량 추가 (E열)
        const currentMemo = values[i][4] || '';
        const stockInfo = `[재고: ${stock}개]`;
        
        if (!currentMemo.includes('[재고:')) {
          values[i][4] = currentMemo ? `${currentMemo} ${stockInfo}` : stockInfo;
        } else {
          values[i][4] = currentMemo.replace(/\[재고:.*?\]/g, stockInfo);
        }
        
        updatedCount++;
        updates.push({
          barcode: barcode,
          productName: values[i][1],
          stock: stock,
          status: stockStatus
        });
      }
    }
    
    // 변경사항 저장
    if (updatedCount > 0) {
      dataRange.setValues(values);
      
      // 메타데이터 업데이트
      const now = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm:ss');
      sheet.getRange(4, 7).setValue('재고확인:').setFontWeight('bold');
      sheet.getRange(4, 8).setValue(now);
      sheet.getRange(4, 9).setValue(`(API 연동)`);
    }
    
    console.log(`${updatedCount}개 항목 업데이트 완료`);
    
    return {
      success: true,
      message: `${updatedCount}개 항목의 재고 정보가 업데이트되었습니다.`,
      updatedCount: updatedCount,
      updates: updates,
      source: 'Smaregi API'
    };
    
  } catch (error) {
    console.error('발주서 업데이트 실패:', error);
    return {
      success: false,
      message: '업데이트 중 오류 발생',
      error: error.toString()
    };
  }
}

/**
 * ダッシュボード用 Smaregi 要約情報
 * @returns {Object} 要約情報
 */
function getSmaregiSummary() {
  try {
    // プラットフォームAPI使用可能かチェック
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        // プラットフォームAPIモード
        const testResult = testPlatformConnection();
        
        return {
          success: true,
          connected: testResult.success,
          hasData: testResult.success && testResult.stores > 0,
          message: testResult.message,
          apiVersion: 'Platform API v4',
          environment: config.ENVIRONMENT,
          stores: testResult.stores || 0,
          totalItems: 0,
          outOfStock: 0,
          lowStock: 0,
          normalStock: 0
        };
      }
    }
    
    // API v2モード（データ取得不可）
    return {
      success: false,
      connected: false,
      hasData: false,
      message: 'API設定が必要です',
      apiVersion: 'None',
      totalItems: 0,
      outOfStock: 0,
      lowStock: 0,
      normalStock: 0
    };
    
  } catch (error) {
    console.error('Smaregi 要約情報取得失敗:', error);
    return {
      success: false,
      connected: false,
      message: '接続エラー: ' + error.toString(),
      error: error.toString()
    };
  }
}

/**
 * 재고 알림 생성
 * @param {Object} stats - 재고 통계
 * @returns {Array} 알림 목록
 */
function generateStockAlerts(stats) {
  const alerts = [];
  
  if (stats.outOfStock > 0) {
    alerts.push({
      type: 'error',
      title: '재고 소진',
      message: `${stats.outOfStock}개 상품의 재고가 소진되었습니다.`,
      action: 'viewOutOfStock'
    });
  }
  
  if (stats.lowStock > 20) {
    alerts.push({
      type: 'warning',
      title: '재고 부족',
      message: `${stats.lowStock}개 상품이 재고 부족 상태입니다.`,
      action: 'viewLowStock'
    });
  }
  
  const criticalItems = stats.suggestions.filter(item => item.priority === 1);
  if (criticalItems.length > 0) {
    alerts.push({
      type: 'alert',
      title: '긴급 발주 필요',
      message: `${criticalItems.length}개 상품이 긴급 발주가 필요합니다.`,
      action: 'createUrgentOrder'
    });
  }
  
  return alerts;
}

/**
 * 자동 동기화 스케줄러 (트리거용)
 */
function syncSmaregiData() {
  try {
    console.log('=== Smaregi 자동 동기화 시작 ===');
    
    // 재고 데이터 새로고침
    const stockData = getSmaregiStockData();
    if (!stockData.success) {
      console.error('자동 동기화 실패:', stockData.error);
      return;
    }
    
    // 캐시 무효화
    invalidateCache(CACHE_KEYS.SMAREGI_DATA);
    invalidateCache(CACHE_KEYS.DASHBOARD_DATA);
    
    // 동기화 시간 업데이트
    const scriptProps = PropertiesService.getScriptProperties();
    scriptProps.setProperty('SMAREGI_LAST_SYNC', new Date().toISOString());
    
    console.log(`자동 동기화 완료: ${stockData.count}개 항목`);
    
    // 재고 부족 알림 확인
    const lowStock = detectLowStockItems();
    if (lowStock.success && lowStock.count > 10) {
      // 필요시 이메일 알림 등 추가 가능
      console.log(`주의: ${lowStock.count}개 상품 재고 부족`);
    }
    
  } catch (error) {
    console.error('자동 동기화 오류:', error);
  }
}

/**
 * 트리거 설정 (자동 동기화)
 */
function setupSmaregiTriggers() {
  try {
    // 기존 트리거 삭제
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'syncSmaregiData') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    
    // 30분마다 동기화
    ScriptApp.newTrigger('syncSmaregiData')
      .timeBased()
      .everyMinutes(30)
      .create();
      
    console.log('Smaregi 자동 동기화 트리거 설정 완료');
    
    return {
      success: true,
      message: '자동 동기화가 30분마다 실행되도록 설정되었습니다.'
    };
    
  } catch (error) {
    console.error('트리거 설정 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 발주 제안 자동 생성 (빠른 발주용)
 * @returns {Array} 발주 제안 목록
 */
function getQuickOrderSuggestions() {
  try {
    // 긴급 발주가 필요한 상품만
    const suggestions = generateSmaregiOrderSuggestions({
      threshold: 5,
      limit: 30
    });
    
    // 우선순위 1, 2만 필터링
    return suggestions.filter(item => item.priority <= 2);
    
  } catch (error) {
    console.error('빠른 발주 제안 생성 실패:', error);
    return [];
  }
}

// ===== 기존 함수 호환성 유지 (점진적 마이그레이션) =====

/**
 * CSV 업로드 함수 (Deprecated - API 사용 권장)
 * @deprecated API 연동으로 대체됨
 */
function uploadSmaregiCSV(csvContent) {
  console.warn('CSV 업로드는 더 이상 사용되지 않습니다. API 연동을 사용하세요.');
  
  return {
    success: false,
    message: 'CSV 업로드 기능은 API 연동으로 대체되었습니다. 설정에서 Smaregi API 연동을 확인하세요.'
  };
}

/**
 * 재고 데이터 가져오기 (API 방식으로 변경)
 */
function getSmaregiData() {
  try {
    const stockData = getSmaregiStockData();
    if (stockData.success) {
      // 기존 형식으로 변환
      const data = {};
      Object.entries(stockData.data).forEach(([barcode, info]) => {
        data[barcode] = info.quantity;
      });
      
      return {
        data: data,
        uploadTime: stockData.timestamp
      };
    }
    
    return {
      data: {},
      uploadTime: null
    };
    
  } catch (error) {
    console.error('Smaregi 데이터 조회 실패:', error);
    return {
      data: {},
      uploadTime: null
    };
  }
}

/**
 * API 연결 상태 초기화 (웹앱에서 사용)
 */
function initializeAPIConnection() {
  try {
    // Platform API 우선 시도
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API 초기화 시도');
        
        // 토큰 발급 테스트
        const tokenData = getPlatformAccessToken();
        
        if (tokenData) {
          // 매장 조회로 연결 확인
          const stores = getPlatformStores();
          
          if (stores && stores.length > 0) {
            return {
              success: true,
              connected: true,
              apiType: 'platform',
              message: 'Platform API 연결 성공',
              stores: stores.length
            };
          }
        }
      }
    }
    
    // Legacy API 시도
    const legacyResult = testSmaregiConnection();
    if (legacyResult.success) {
      return {
        success: true,
        connected: true,
        apiType: 'legacy',
        message: 'Legacy API 연결 성공',
        stores: legacyResult.stores
      };
    }
    
    return {
      success: false,
      connected: false,
      message: 'API 연결 실패',
      error: 'API 설정을 확인해주세요'
    };
    
  } catch (error) {
    console.error('API 초기화 실패:', error);
    return {
      success: false,
      connected: false,
      message: '초기화 실패',
      error: error.toString()
    };
  }
}

/**
 * 수동 재고 동기화 (웹앱에서 호출)
 */
function syncSmaregiData() {
  try {
    console.log('=== 수동 재고 동기화 시작 ===');
    
    // 캐시 삭제
    const cache = CacheService.getScriptCache();
    cache.remove('platform_stock_data');
    cache.remove('all_products_map');
    
    // 새로운 데이터 가져오기
    const stockResult = getSmaregiStockData();
    
    if (stockResult.success) {
      return {
        success: true,
        message: `${stockResult.count}개 상품의 재고 정보가 동기화되었습니다.`,
        itemCount: stockResult.count,
        timestamp: stockResult.timestamp
      };
    } else {
      return {
        success: false,
        message: '동기화 실패: ' + (stockResult.message || stockResult.error),
        error: stockResult.error
      };
    }
    
  } catch (error) {
    console.error('동기화 실패:', error);
    return {
      success: false,
      message: '동기화 중 오류가 발생했습니다.',
      error: error.toString()
    };
  }
}

// checkSmaregiConnection 함수 개선 (smaregiManager.gs)
function checkSmaregiConnection() {
  try {
    console.log('=== Smaregi 연결 상태 확인 ===');
    
    // Platform API 확인
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        // 토큰 확인
        const tokenData = getPlatformAccessToken();
        
        if (tokenData && tokenData.access_token) {
          console.log('토큰 발급 성공');
          console.log('스코프:', tokenData.scope);
          
          // 재고 데이터 확인 (캐시 활용)
          const stockData = getSmaregiStockData();
          
          if (stockData.success && stockData.count > 0) {
            console.log(`Platform API 연결 확인: ${stockData.count}개 재고`);
            
            return {
              connected: true,
              hasData: true,
              apiType: 'platform',
              itemCount: stockData.count,
              storeId: stockData.storeId,
              message: `Platform API 연결됨 (${stockData.count}개 상품)`
            };
          } else {
            // 재고 데이터가 없으면 상품 수만 확인
            const productMap = getAllProductsMap();
            const productCount = Object.keys(productMap).length;
            
            return {
              connected: true,
              hasData: productCount > 0,
              apiType: 'platform',
              itemCount: productCount,
              message: `API 연결됨 (${productCount}개 상품 등록)`
            };
          }
        }
      }
    }
    
    // 연결 실패
    return {
      connected: false,
      hasData: false,
      apiType: null,
      itemCount: 0,
      message: 'API 설정 없음'
    };
    
  } catch (error) {
    console.error('연결 상태 확인 실패:', error);
    return {
      connected: false,
      hasData: false,
      error: error.toString()
    };
  }
}
