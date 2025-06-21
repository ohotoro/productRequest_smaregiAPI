// ===== salesDataAPI.gs - 판매 데이터 조회 및 분석 =====

/**
 * 여러 상품의 판매 데이터 일괄 조회
 * @param {Array} barcodes - 바코드 배열
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 판매 데이터 배열
 */
function getBatchSalesData(barcodes, days = 30) {
  try {
    console.log(`=== ${barcodes.length}개 상품의 ${days}일 판매 데이터 조회 ===`);
    
    // Smaregi API 연결 확인
    if (!isSmaregiAvailable()) {
      console.log('Smaregi API 미연결 - 빈 데이터 반환');
      return barcodes.map(barcode => ({
        barcode: barcode,
        quantity: 0,
        amount: 0,
        count: 0,
        avgDaily: 0,
        trend: 'unknown'
      }));
    }
    
    // 캐시 키 생성
    const cacheKey = `sales_batch_${days}_${Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5, 
      barcodes.join(',')
    )}`;
    
    // 캐시 확인
    const cached = getCache(cacheKey);
    if (cached) {
      console.log('캐시된 판매 데이터 반환');
      return cached;
    }
    
    // 날짜 범위 설정
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // 판매 데이터 조회
    const salesData = getSmaregiSalesDataByProducts(startDate, endDate, barcodes);
    
    // 결과 데이터 생성
    const results = barcodes.map(barcode => {
      const sales = salesData[barcode] || {
        quantity: 0,
        amount: 0,
        transactions: []
      };
      
      // 일평균 계산
      const avgDaily = sales.quantity / days;
      
      // 추세 분석 (간단 버전)
      const trend = analyzeSalesTrend(sales.transactions, days);
      
      return {
        barcode: barcode,
        quantity: sales.quantity,
        amount: sales.amount,
        count: sales.transactions.length,
        avgDaily: parseFloat(avgDaily.toFixed(2)),
        trend: trend,
        lastSale: sales.lastSale || null
      };
    });
    
    // 캐시 저장 (1시간)
    setCache(cacheKey, results, CACHE_DURATION.LONG);
    
    console.log(`${results.length}개 상품 판매 데이터 조회 완료`);
    return results;
    
  } catch (error) {
    console.error('판매 데이터 일괄 조회 실패:', error);
    // 오류 시 빈 데이터 반환
    return barcodes.map(barcode => ({
      barcode: barcode,
      quantity: 0,
      amount: 0,
      count: 0,
      avgDaily: 0,
      trend: 'unknown'
    }));
  }
}

/**
 * Smaregi에서 특정 상품들의 판매 데이터 조회
 * @private
 */
function getSmaregiSalesDataByProducts(startDate, endDate, barcodes) {
  try {
    const storeId = getDefaultStoreId();
    if (!storeId) {
      console.log('매장 ID를 찾을 수 없습니다');
      return {};
    }
    
    // API 엔드포인트 구성
    const start = Utilities.formatDate(startDate, 'GMT+9', 'yyyy-MM-dd');
    const end = Utilities.formatDate(endDate, 'GMT+9', 'yyyy-MM-dd');
    
    // 상품별 판매 데이터
    const productSales = {};
    
    // Platform API 사용 확인
    const isPlatformAPI = CONFIG && CONFIG.PLATFORM_CONFIG && CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
    
    if (isPlatformAPI) {
      // Platform API용 엔드포인트
      console.log('Platform API로 판매 데이터 조회');
      
      // 전체 거래 데이터 조회 (상품 코드 필터링은 나중에)
      const endpoint = `${CONFIG.PLATFORM_CONFIG.USE_PRODUCTION ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL}${CONFIG.PLATFORM_CONFIG.USE_PRODUCTION ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID}/pos/transactions?limit=1000&transaction_date_time_from=${start}T00:00:00&transaction_date_time_to=${end}T23:59:59`;
      
      const accessToken = getPlatformAccessToken();
      if (!accessToken) {
        console.error('Platform API 토큰 획득 실패');
        return {};
      }
      
      const options = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(endpoint, options);
      const statusCode = response.getResponseCode();
      
      if (statusCode === 200) {
        const data = JSON.parse(response.getContentText());
        
        // 바코드별로 판매 데이터 집계
        barcodes.forEach(barcode => {
          productSales[barcode] = {
            quantity: 0,
            amount: 0,
            transactions: []
          };
        });
        
        // 거래 데이터 처리
        if (data && data.length > 0) {
          data.forEach(transaction => {
            if (transaction.details && Array.isArray(transaction.details)) {
              transaction.details.forEach(detail => {
                const productCode = detail.product_code || detail.productCode;
                if (productCode && barcodes.includes(productCode)) {
                  if (!productSales[productCode]) {
                    productSales[productCode] = {
                      quantity: 0,
                      amount: 0,
                      transactions: []
                    };
                  }
                  
                  productSales[productCode].quantity += detail.quantity || 0;
                  productSales[productCode].amount += detail.amount || detail.subtotal || 0;
                  productSales[productCode].transactions.push({
                    date: transaction.transaction_date_time || transaction.transactionDateTime,
                    quantity: detail.quantity
                  });
                }
              });
            }
          });
        }
        
        console.log(`Platform API로 ${Object.keys(productSales).length}개 상품 판매 데이터 조회 완료`);
        
      } else {
        console.error(`Platform API 판매 데이터 조회 실패: ${statusCode}`);
        console.error(response.getContentText());
      }
      
    } else {
      // Legacy API 사용
      console.log('Legacy API로 판매 데이터 조회');
      
      // 배치 처리 (100개씩)
      const batchSize = 100;
      for (let i = 0; i < barcodes.length; i += batchSize) {
        const batch = barcodes.slice(i, i + batchSize);
        
        // Legacy API는 상품 코드로 필터링 불가능하므로 전체 조회 후 필터링
        const endpoint = `pos/transactions?store_id=${storeId}&transaction_date_from=${start}&transaction_date_to=${end}&limit=1000`;
        const result = callSmaregiAPI(endpoint);
        
        if (result.success && result.data) {
          // 거래 데이터 처리
          result.data.forEach(transaction => {
            if (transaction.details) {
              transaction.details.forEach(detail => {
                const barcode = detail.productCode || detail.product_code;
                
                if (barcode && batch.includes(barcode)) {
                  if (!productSales[barcode]) {
                    productSales[barcode] = {
                      quantity: 0,
                      amount: 0,
                      transactions: []
                    };
                  }
                  
                  productSales[barcode].quantity += detail.quantity || 0;
                  productSales[barcode].amount += detail.amount || detail.subtotal || 0;
                  productSales[barcode].transactions.push({
                    date: transaction.transactionDateTime || transaction.transaction_date_time,
                    quantity: detail.quantity
                  });
                }
              });
            }
          });
        }
        
        // API 호출 제한 대응
        if (i + batchSize < barcodes.length) {
          Utilities.sleep(500); // 0.5초 대기
        }
      }
    }
    
    return productSales;
    
  } catch (error) {
    console.error('판매 데이터 조회 중 오류:', error);
    return {};
  }
}

// Platform API용 판매 데이터 조회 함수 추가
function getPlatformSalesDataByProducts(startDate, endDate, barcodes) {
  try {
    const storeId = getDefaultStoreId();
    if (!storeId) return {};
    
    // 날짜 포맷
    const start = Utilities.formatDate(startDate, 'GMT+9', 'yyyy-MM-dd');
    const end = Utilities.formatDate(endDate, 'GMT+9', 'yyyy-MM-dd');
    
    console.log(`Platform API 판매 데이터 조회: ${start} ~ ${end}`);
    
    // 상품별 판매 데이터 저장용
    const productSales = {};
    
    // 모든 거래 내역 조회 (페이징 처리)
    let page = 1;
    const limit = 1000;
    let hasMoreData = true;
    
    while (hasMoreData) {
      // Platform API 엔드포인트 (파라미터 이름 주의: store_id, transaction_date_from 등)
      const endpoint = `pos/transactions?store_id=${storeId}&transaction_date_from=${start}&transaction_date_to=${end}&limit=${limit}&page=${page}`;
      const result = callPlatformAPI(endpoint);
      
      if (!result.success || !result.data || result.data.length === 0) {
        hasMoreData = false;
        break;
      }
      
      // 거래 데이터 처리
      result.data.forEach(transaction => {
        // Platform API의 거래 상세 정보 처리
        if (transaction.details && Array.isArray(transaction.details)) {
          transaction.details.forEach(detail => {
            // productCode가 요청한 바코드 목록에 있는지 확인
            const barcode = detail.productCode || detail.product_code;
            
            if (barcode && barcodes.includes(barcode)) {
              if (!productSales[barcode]) {
                productSales[barcode] = {
                  quantity: 0,
                  amount: 0,
                  transactions: []
                };
              }
              
              const quantity = parseInt(detail.quantity) || 0;
              const amount = parseFloat(detail.subtotal || detail.price * quantity) || 0;
              
              productSales[barcode].quantity += quantity;
              productSales[barcode].amount += amount;
              productSales[barcode].transactions.push({
                date: transaction.transactionDateTime || transaction.transaction_date_time,
                quantity: quantity,
                amount: amount
              });
              
              // 마지막 판매일 업데이트
              const transDate = transaction.transactionDateTime || transaction.transaction_date_time;
              if (!productSales[barcode].lastSale || transDate > productSales[barcode].lastSale) {
                productSales[barcode].lastSale = transDate;
              }
            }
          });
        }
      });
      
      console.log(`페이지 ${page}: ${result.data.length}건 처리`);
      
      // 다음 페이지 확인
      if (result.data.length < limit) {
        hasMoreData = false;
      } else {
        page++;
        // API 호출 제한 대응
        Utilities.sleep(200); // 0.2초 대기
      }
    }
    
    console.log(`판매 데이터 조회 완료: ${Object.keys(productSales).length}개 상품`);
    
    return productSales;
    
  } catch (error) {
    console.error('Platform API 판매 데이터 조회 실패:', error);
    return {};
  }
}

// 매장 ID 가져오기 함수도 Platform API 지원 추가
function getDefaultStoreId() {
  try {
    // Platform API 사용 시
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        const stores = getPlatformStores();
        if (stores && stores.length > 0) {
          // 첫 번째 활성 매장 반환
          const activeStore = stores.find(store => store.isActive !== false) || stores[0];
          return activeStore.storeId || activeStore.store_id;
        }
      }
    }
    
    // Legacy API fallback
    const stores = getSmaregiStores();
    if (stores && stores.length > 0) {
      const activeStore = stores.find(store => store.isActive) || stores[0];
      return activeStore.storeId;
    }
    
    return null;
    
  } catch (error) {
    console.error('매장 ID 조회 실패:', error);
    return null;
  }
}

// Platform API용 매장 목록 조회 함수
function getPlatformStores() {
  try {
    const cached = getCache('platform_stores');
    if (cached) return cached;
    
    const result = callPlatformAPI('pos/stores');
    
    if (result.success) {
      // 캐시 저장 (1시간)
      setCache('platform_stores', result.data, CACHE_DURATION.LONG);
      return result.data;
    }
    
    return [];
    
  } catch (error) {
    console.error('Platform API 매장 목록 조회 실패:', error);
    return [];
  }
}

/**
 * 판매 추세 분석
 * @private
 */
function analyzeSalesTrend(transactions, totalDays) {
  if (!transactions || transactions.length === 0) {
    return 'stable';
  }
  
  // 기간을 반으로 나누어 비교
  const midPoint = new Date();
  midPoint.setDate(midPoint.getDate() - Math.floor(totalDays / 2));
  
  let firstHalfQty = 0;
  let secondHalfQty = 0;
  
  transactions.forEach(trans => {
    const transDate = new Date(trans.date);
    if (transDate < midPoint) {
      firstHalfQty += trans.quantity;
    } else {
      secondHalfQty += trans.quantity;
    }
  });
  
  // 변화율 계산
  if (firstHalfQty === 0) {
    return secondHalfQty > 0 ? 'up' : 'stable';
  }
  
  const changeRate = (secondHalfQty - firstHalfQty) / firstHalfQty;
  
  if (changeRate > 0.2) return 'up';      // 20% 이상 증가
  if (changeRate < -0.2) return 'down';   // 20% 이상 감소
  return 'stable';
}

/**
 * 상품별 판매 예측 (간단 버전)
 * @param {string} barcode - 바코드
 * @param {number} days - 예측 기간
 * @returns {Object} 예측 정보
 */
function predictSales(barcode, days = 7) {
  try {
    // 과거 30일 데이터로 예측
    const historicalData = getBatchSalesData([barcode], 30)[0];
    
    if (!historicalData || historicalData.avgDaily === 0) {
      return {
        barcode: barcode,
        predictedQuantity: 0,
        confidence: 'low',
        suggestedOrder: 0
      };
    }
    
    // 추세 반영
    let multiplier = 1.0;
    if (historicalData.trend === 'up') {
      multiplier = 1.2; // 20% 증가 예상
    } else if (historicalData.trend === 'down') {
      multiplier = 0.8; // 20% 감소 예상
    }
    
    const predictedDaily = historicalData.avgDaily * multiplier;
    const predictedQuantity = Math.ceil(predictedDaily * days);
    
    // 현재 재고 확인
    const currentStock = getSmaregiStockByBarcode(barcode);
    const stockLevel = currentStock.success ? currentStock.stock : 0;
    
    // 발주 제안량 (예측 판매량 + 안전재고 - 현재재고)
    const safetyStock = Math.ceil(predictedDaily * 3); // 3일치 안전재고
    const suggestedOrder = Math.max(0, predictedQuantity + safetyStock - stockLevel);
    
    return {
      barcode: barcode,
      currentStock: stockLevel,
      avgDailySales: historicalData.avgDaily,
      predictedQuantity: predictedQuantity,
      safetyStock: safetyStock,
      suggestedOrder: suggestedOrder,
      confidence: historicalData.count > 10 ? 'high' : 'medium',
      trend: historicalData.trend
    };
    
  } catch (error) {
    console.error('판매 예측 실패:', error);
    return {
      barcode: barcode,
      predictedQuantity: 0,
      confidence: 'low',
      suggestedOrder: 0
    };
  }
}

/**
 * 베스트셀러 상품 조회 (판매량 기준)
 * @param {number} days - 조회 기간
 * @param {number} limit - 조회 개수
 * @returns {Array} 베스트셀러 목록
 */
function getBestSellers(days = 30, limit = 20) {
  try {
    // Smaregi API로 전체 판매 데이터 조회
    const topSelling = getSmaregiTopSellingProducts(days, limit * 2);
    
    // 상품 정보 추가
    const barcodes = topSelling.map(item => item.barcode);
    const productMap = getProductsByBarcodes(barcodes);
    
    // 결과 생성
    const bestSellers = topSelling
      .filter(item => productMap[item.barcode]) // 상품 정보가 있는 것만
      .map(item => {
        const product = productMap[item.barcode];
        const prediction = predictSales(item.barcode, 7);
        
        return {
          rank: 0, // 나중에 설정
          barcode: item.barcode,
          name: product.name,
          option: product.option,
          supplierName: product.supplierName,
          salesQuantity: item.quantity,
          salesAmount: item.amount,
          avgDailySales: parseFloat((item.quantity / days).toFixed(2)),
          currentStock: prediction.currentStock,
          suggestedOrder: prediction.suggestedOrder,
          stockDays: prediction.currentStock > 0 ? 
            Math.floor(prediction.currentStock / prediction.avgDailySales) : 0
        };
      })
      .slice(0, limit);
    
    // 순위 설정
    bestSellers.forEach((item, index) => {
      item.rank = index + 1;
    });
    
    return bestSellers;
    
  } catch (error) {
    console.error('베스트셀러 조회 실패:', error);
    return [];
  }
}

/**
 * 대시보드용 판매 통계
 * @returns {Object} 판매 통계
 */
function getSalesStatistics() {
  try {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const thisWeek = new Date();
    thisWeek.setDate(thisWeek.getDate() - 7);
    
    const thisMonth = new Date();
    thisMonth.setMonth(thisMonth.getMonth() - 1);
    
    // 기간별 판매 데이터
    const todaySales = getSmaregiSalesData(today, today);
    const yesterdaySales = getSmaregiSalesData(yesterday, yesterday);
    const weekSales = getSmaregiSalesData(thisWeek, today);
    const monthSales = getSmaregiSalesData(thisMonth, today);
    
    // 통계 계산
    const stats = {
      today: {
        quantity: 0,
        amount: 0,
        transactions: 0
      },
      yesterday: {
        quantity: 0,
        amount: 0,
        transactions: 0
      },
      week: {
        quantity: 0,
        amount: 0,
        avgDaily: 0
      },
      month: {
        quantity: 0,
        amount: 0,
        avgDaily: 0
      },
      trends: {
        dailyChange: 0,
        weeklyChange: 0
      }
    };
    
    // 데이터 처리
    if (todaySales.success) {
      stats.today = calculateSalesSummary(todaySales.data);
    }
    
    if (yesterdaySales.success) {
      stats.yesterday = calculateSalesSummary(yesterdaySales.data);
    }
    
    if (weekSales.success) {
      const weekSummary = calculateSalesSummary(weekSales.data);
      stats.week = {
        ...weekSummary,
        avgDaily: parseFloat((weekSummary.quantity / 7).toFixed(2))
      };
    }
    
    if (monthSales.success) {
      const monthSummary = calculateSalesSummary(monthSales.data);
      stats.month = {
        ...monthSummary,
        avgDaily: parseFloat((monthSummary.quantity / 30).toFixed(2))
      };
    }
    
    // 변화율 계산
    if (stats.yesterday.amount > 0) {
      stats.trends.dailyChange = 
        ((stats.today.amount - stats.yesterday.amount) / stats.yesterday.amount * 100).toFixed(1);
    }
    
    return stats;
    
  } catch (error) {
    console.error('판매 통계 생성 실패:', error);
    return null;
  }
}

/**
 * 판매 데이터 요약 계산
 * @private
 */
function calculateSalesSummary(salesData) {
  let quantity = 0;
  let amount = 0;
  let transactions = 0;
  
  if (Array.isArray(salesData)) {
    salesData.forEach(transaction => {
      transactions++;
      transaction.details.forEach(detail => {
        quantity += detail.quantity;
        amount += detail.subtotal;
      });
    });
  }
  
  return { quantity, amount, transactions };
}

// ===== salesDataAPI.gs에 추가할 함수 =====

/**
 * 전체 상품의 판매 데이터 로드 (수정 버전)
 * @returns {Object} 전체 판매 데이터
 */
function loadAllProductsSalesData() {
  try {
    console.log('=== 전체 상품 판매 데이터 로드 시작 ===');
    
    // API 연결 확인
    if (!isSmaregiAvailable()) {
      console.log('Smaregi API 미연결');
      
      // 테스트용 더미 데이터 반환 (개발 중일 때만)
      const dummyData = {};
      const testBarcodes = ['1000008038', '1000008039', '1000008040'];
      testBarcodes.forEach(barcode => {
        dummyData[barcode] = {
          quantity: Math.floor(Math.random() * 100),
          avgDaily: Math.random() * 10,
          trend: ['up', 'down', 'stable'][Math.floor(Math.random() * 3)],
          count: Math.floor(Math.random() * 30),
          lastUpdate: new Date().toISOString()
        };
      });
      
      return {
        success: true,
        data: dummyData,
        timestamp: new Date().toISOString(),
        cached: false,
        message: '테스트 데이터 사용 중'
      };
    }
    
    // 캐시 확인
    const cacheKey = 'ALL_PRODUCTS_SALES_DATA';
    const cached = getCache(cacheKey);
    if (cached) {
      console.log('캐시된 판매 데이터 사용');
      return {
        success: true,
        data: cached.data,
        timestamp: cached.timestamp,
        cached: true
      };
    }
    
    // 설정에서 기간 가져오기
    const settings = getSettings();
    const longPeriod = parseInt(settings.salesPeriodLong) || 30;
    
    // 날짜 범위 설정
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - longPeriod);
    
    // 전체 상품 바코드 가져오기
    const allProducts = getProductBarcodes();
    if (!allProducts || allProducts.length === 0) {
      console.log('상품 목록이 비어있습니다');
      return {
        success: true,
        data: {},
        timestamp: new Date().toISOString(),
        totalProducts: 0,
        cached: false
      };
    }
    
    console.log(`총 ${allProducts.length}개 상품 판매 데이터 조회`);
    
    // 판매 데이터 수집
    const salesDataMap = {};
    
    // 배치 처리 (50개씩으로 줄임)
    const batchSize = 50;
    let processedCount = 0;
    
    for (let i = 0; i < allProducts.length; i += batchSize) {
      const batch = allProducts.slice(i, i + batchSize);
      
      try {
        // getBatchSalesData 함수 활용
        const batchResults = getBatchSalesData(batch, longPeriod);
        
        // 결과를 맵에 저장
        batchResults.forEach(result => {
          if (result.barcode) {
            salesDataMap[result.barcode] = {
              quantity: result.quantity || 0,
              avgDaily: result.avgDaily || 0,
              trend: result.trend || 'stable',
              count: result.count || 0,
              lastUpdate: new Date().toISOString()
            };
            processedCount++;
          }
        });
        
        // 진행상황 로그
        console.log(`판매 데이터 로드: ${Math.min(i + batchSize, allProducts.length)}/${allProducts.length}`);
        
        // API 호출 제한 대응
        if (i + batchSize < allProducts.length) {
          Utilities.sleep(300); // 0.3초 대기
        }
        
      } catch (error) {
        console.error(`배치 ${i}-${i+batchSize} 처리 실패:`, error);
        // 실패한 배치는 0으로 초기화
        batch.forEach(barcode => {
          salesDataMap[barcode] = {
            quantity: 0,
            avgDaily: 0,
            trend: 'unknown',
            count: 0,
            lastUpdate: new Date().toISOString(),
            error: true
          };
        });
      }
      
      // 10배치마다 중간 저장 (에러 발생 시 데이터 보존)
      if (i > 0 && i % (batchSize * 10) === 0) {
        const intermediateResult = {
          data: salesDataMap,
          timestamp: new Date().toISOString(),
          totalProducts: allProducts.length,
          period: longPeriod,
          processedCount: processedCount
        };
        setCache(cacheKey + '_temp', intermediateResult, 300); // 5분 캐시
      }
    }
    
    // 결과 캐싱 (2시간)
    const result = {
      data: salesDataMap,
      timestamp: new Date().toISOString(),
      totalProducts: allProducts.length,
      processedCount: processedCount,
      period: longPeriod
    };
    
    setCache(cacheKey, result, CACHE_DURATION.LONG * 2);
    
    console.log(`판매 데이터 로드 완료: ${processedCount}/${allProducts.length}개`);
    
    return {
      success: true,
      data: salesDataMap,
      timestamp: result.timestamp,
      totalProducts: result.totalProducts,
      processedCount: result.processedCount,
      cached: false
    };
    
  } catch (error) {
    console.error('전체 판매 데이터 로드 실패:', error);
    
    // 임시 캐시 확인
    const tempCache = getCache('ALL_PRODUCTS_SALES_DATA_temp');
    if (tempCache) {
      console.log('임시 캐시 데이터 사용');
      return {
        success: true,
        data: tempCache.data,
        timestamp: tempCache.timestamp,
        totalProducts: tempCache.totalProducts,
        processedCount: tempCache.processedCount,
        cached: true,
        partial: true
      };
    }
    
    return {
      success: false,
      data: {},
      error: error.toString()
    };
  }
}

/**
 * 전체 상품 바코드 목록 가져오기
 * @private
 */
function getProductBarcodes() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    
    if (!sheet) {
      throw new Error('상품 시트를 찾을 수 없습니다');
    }
    
    const lastRow = sheet.getLastRow();
    const barcodeColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    
    const barcodes = [];
    for (let i = 0; i < barcodeColumn.length; i++) {
      if (barcodeColumn[i][0]) {
        barcodes.push(String(barcodeColumn[i][0]));
      }
    }
    
    return barcodes;
    
  } catch (error) {
    console.error('바코드 목록 가져오기 실패:', error);
    return [];
  }
}

/**
 * 개별 상품 판매 정보 조회 (간단 버전)
 * @param {string} barcode - 바코드
 * @returns {Object} 판매 정보
 */
function getProductSalesData(barcode) {
  try {
    // 먼저 전체 캐시에서 확인
    const allDataCache = getCache('ALL_PRODUCTS_SALES_DATA');
    if (allDataCache && allDataCache.data && allDataCache.data[barcode]) {
      return {
        success: true,
        salesInfo: allDataCache.data[barcode]
      };
    }
    
    // 개별 조회
    const settings = getSettings();
    const shortPeriod = parseInt(settings.salesPeriodShort) || 7;
    const longPeriod = parseInt(settings.salesPeriodLong) || 30;
    
    const salesData = getBatchSalesData([barcode], longPeriod);
    
    if (salesData && salesData.length > 0 && salesData[0]) {
      const data = salesData[0];
      
      // 단기 판매량 계산
      const recentSales = getBatchSalesData([barcode], shortPeriod);
      const recentQty = recentSales && recentSales[0] ? recentSales[0].quantity : 0;
      
      const salesInfo = {
        totalQty: data.quantity || 0,
        avgDaily: data.avgDaily || 0,
        trend: data.trend || 'stable',
        lastShortDays: recentQty,
        lastUpdate: new Date().toISOString(),
        shortPeriod: shortPeriod,
        longPeriod: longPeriod
      };
      
      return {
        success: true,
        salesInfo: salesInfo
      };
    }
    
    // 데이터가 없는 경우
    return {
      success: true,
      salesInfo: {
        totalQty: 0,
        avgDaily: 0,
        trend: 'unknown',
        lastShortDays: 0,
        lastUpdate: new Date().toISOString(),
        shortPeriod: shortPeriod,
        longPeriod: longPeriod
      }
    };
    
  } catch (error) {
    console.error('개별 판매 정보 조회 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}
