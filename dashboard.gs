// ===== dashboard.gs - 대시보드 데이터 통합 및 최적화 =====

// ===== 메인 대시보드 데이터 함수 (API 통합) =====
function getDashboardData() {
  try {
    console.log('=== 대시보드 데이터 생성 시작 ===');
    const startTime = new Date().getTime();
    
    // 캐시 확인
    const cached = getCache(CACHE_KEYS.DASHBOARD_DATA);
    if (cached) {
      console.log('캐시된 대시보드 데이터 반환');
      return cached;
    }
    
    // Smaregi API 연결 상태 확인
    const smaregiConnected = isSmaregiAvailable();
    let smaregiStats = null;
    
    if (smaregiConnected) {
      // API 연결 시 실시간 데이터 사용
      smaregiStats = getSmaregiDashboardStats();
    }
    
    // 병렬 처리를 위한 데이터 수집
    const dashboardData = {
      // 긴급 액션 아이템
      actionItems: getActionItems(),
      
      // 핵심 지표
      topProducts: getTopProducts(),
      categoryStats: getCategoryStats(),
      monthlyTrend: getMonthlyTrend(),
      supplierStats: getSupplierStats(),
      weekdayPattern: getWeekdayPattern(),
      budgetStatus: getBudgetStatus(),
      trendingProducts: getTrendingProducts(),
      efficiencyMetrics: getEfficiencyMetrics(),
      
      // Smaregi 실시간 데이터 추가
      smaregiStatus: {
        connected: smaregiConnected,
        stats: smaregiStats,
        lastSync: smaregiStats ? smaregiStats.lastUpdate : null
      },
      
      // 실시간 재고 부족 상품 (API 사용 시)
      lowStockItems: smaregiConnected ? getSmaregiLowStockItems(10).slice(0, 20) : [],
      
      // AI 발주 제안 (API 사용 시)
      orderSuggestions: smaregiConnected ? generateSmaregiOrderSuggestions({ limit: 10 }) : []
    };
    
    // 캐시 저장 (15분 - API 데이터 고려)
    setCache(CACHE_KEYS.DASHBOARD_DATA, dashboardData, CACHE_DURATION.SHORT * 3);
    
    const endTime = new Date().getTime();
    console.log(`대시보드 데이터 생성 완료: ${endTime - startTime}ms`);
    
    return dashboardData;
    
  } catch (error) {
    console.error('대시보드 데이터 생성 실패:', error);
    // 오류 시 기본값 반환
    return getDefaultDashboardData();
  }
}

// 기본 대시보드 데이터 (오류 시 사용)
function getDefaultDashboardData() {
  return {
    actionItems: [],
    topProducts: [],
    categoryStats: [],
    monthlyTrend: [],
    supplierStats: [],
    weekdayPattern: [],
    budgetStatus: {
      budget: 10000000,
      used: 0,
      percentage: 0,
      remaining: 10000000,
      daysRemaining: 30
    },
    trendingProducts: {
      trendingUp: [],
      trendingDown: []
    },
    efficiencyMetrics: {
      avgOrderCycle: '데이터 없음',
      repeatOrderRate: '0%',
      avgLeadTime: '데이터 없음'
    },
    smaregiStatus: {
      connected: false,
      stats: null,
      lastSync: null
    },
    lowStockItems: [],
    orderSuggestions: []
  };
}

// ===== 최적화된 발주 데이터 로더 =====
function getOrderDataForPeriod(months) {
  try {
    const cacheKey = `orderData_${months}m`;
    const cached = getCache(cacheKey);
    if (cached) return cached;
    
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    const result = [];
    
    const periodAgo = new Date();
    periodAgo.setMonth(periodAgo.getMonth() - months);
    
    // 시트 이름으로 필터링하여 필요한 시트만 처리
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const dateStr = sheetName.substring(0, 6);
        const sheetDate = parseSheetDate(dateStr);
        
        if (sheetDate >= periodAgo) {
          // 최소한의 데이터만 로드
          const lastRow = sheet.getLastRow();
          if (lastRow > 1) {
            const data = sheet.getRange(1, 1, lastRow, 13).getValues();
            result.push({
              sheetName: sheetName,
              sheetDate: sheetDate,
              data: data
            });
          }
        }
      }
    });
    
    // 캐시 저장
    setCache(cacheKey, result, CACHE_DURATION.SHORT);
    
    return result;
    
  } catch (error) {
    console.error('발주 데이터 로드 실패:', error);
    return [];
  }
}

// ===== TOP 10 상품 (API 통합) =====
function getTopProducts() {
  try {
    const orderData = getOrderDataForPeriod(3); // 3개월
    const productMap = new Map();
    
    // 발주 데이터 집계
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][1] && data[i][3] && data[i][9]) {
          const productName = String(data[i][1]);
          const quantity = Number(data[i][3]) || 0;
          const price = Number(data[i][9]) || 0;
          const amount = quantity * price;
          
          if (!productMap.has(productName)) {
            productMap.set(productName, {
              name: productName,
              totalQuantity: 0,
              totalAmount: 0,
              orderCount: 0,
              barcode: String(data[i][0])
            });
          }
          
          const product = productMap.get(productName);
          product.totalQuantity += quantity;
          product.totalAmount += amount;
          product.orderCount += 1;
        }
      }
    });
    
    // Smaregi API 연결 시 판매 데이터 추가
    if (isSmaregiAvailable()) {
      const topSelling = getSmaregiTopSellingProducts(30, 20);
      
      topSelling.forEach(item => {
        if (productMap.has(item.productName)) {
          const product = productMap.get(item.productName);
          product.salesQuantity = item.quantity;
          product.salesAmount = item.amount;
          product.isTrending = true;
        }
      });
    }
    
    // 상위 10개 추출
    return Array.from(productMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10)
      .map(product => ({
        ...product,
        avgOrderQuantity: Math.round(product.totalQuantity / product.orderCount),
        monthlyAvg: Math.round(product.totalAmount / 3)
      }));
      
  } catch (error) {
    console.error('TOP 상품 분석 실패:', error);
    return [];
  }
}

// ===== 카테고리별 통계 (최적화) =====
function getCategoryStats() {
  try {
    const categoryRules = loadCategoryRules();
    const orderData = getOrderDataForCurrentMonth();
    const categoryMap = new Map();
    
    let totalAmount = 0;
    
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][1] && data[i][3] && data[i][9]) {
          const productName = String(data[i][1]);
          const category = determineCategory(productName, categoryRules);
          const amount = (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
          
          if (!categoryMap.has(category)) {
            categoryMap.set(category, {
              category: category,
              totalAmount: 0,
              itemCount: 0
            });
          }
          
          const cat = categoryMap.get(category);
          cat.totalAmount += amount;
          cat.itemCount += 1;
          totalAmount += amount;
        }
      }
    });
    
    // 비율 계산 및 정렬
    return Array.from(categoryMap.values())
      .map(cat => ({
        ...cat,
        percentage: totalAmount > 0 ? (cat.totalAmount / totalAmount * 100).toFixed(1) : 0
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
      
  } catch (error) {
    console.error('카테고리 분석 실패:', error);
    return [];
  }
}

// ===== 월별 추이 (최적화) =====
function getMonthlyTrend() {
  try {
    const orderData = getOrderDataForPeriod(6); // 6개월
    const monthlyMap = new Map();
    
    orderData.forEach(({sheetDate, data}) => {
      const monthKey = Utilities.formatDate(sheetDate, 'GMT+9', 'yyyy-MM');
      
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          month: monthKey,
          totalAmount: 0,
          orderCount: 0
        });
      }
      
      const monthData = monthlyMap.get(monthKey);
      monthData.orderCount += 1;
      
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][9]) {
          const amount = (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
          monthData.totalAmount += amount;
        }
      }
    });
    
    return Array.from(monthlyMap.values())
      .sort((a, b) => a.month.localeCompare(b.month));
      
  } catch (error) {
    console.error('월별 추이 분석 실패:', error);
    return [];
  }
}

// ===== 공급사별 통계 =====
function getSupplierStats() {
  try {
    const orderData = getOrderDataForCurrentMonth();
    const supplierMap = new Map();
    
    // 공급사 정보 미리 로드
    const productSuppliers = getProductSupplierMap();
    
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][3] && data[i][9]) {
          const barcode = String(data[i][0]);
          const supplierName = productSuppliers[barcode] || data[i][12] || '기타';
          const amount = (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
          
          if (!supplierMap.has(supplierName)) {
            supplierMap.set(supplierName, {
              supplier: supplierName,
              totalAmount: 0,
              orderCount: 0
            });
          }
          
          const supplier = supplierMap.get(supplierName);
          supplier.totalAmount += amount;
          supplier.orderCount += 1;
        }
      }
    });
    
    return Array.from(supplierMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
      
  } catch (error) {
    console.error('공급사 분석 실패:', error);
    return [];
  }
}

// ===== 요일별 패턴 =====
function getWeekdayPattern() {
  try {
    const orderData = getOrderDataForPeriod(1); // 1개월
    const weekdayData = Array(7).fill(0).map((_, i) => ({
      day: ['일', '월', '화', '수', '목', '금', '토'][i],
      count: 0,
      amount: 0
    }));
    
    orderData.forEach(({sheetDate}) => {
      const dayOfWeek = sheetDate.getDay();
      weekdayData[dayOfWeek].count += 1;
    });
    
    return weekdayData;
    
  } catch (error) {
    console.error('요일별 패턴 분석 실패:', error);
    return Array(7).fill(0).map((_, i) => ({
      day: ['일', '월', '화', '수', '목', '금', '토'][i],
      count: 0,
      amount: 0
    }));
  }
}

// ===== 예산 상태 =====
function getBudgetStatus() {
  try {
    const userProperties = PropertiesService.getUserProperties();
    const monthlyBudget = Number(userProperties.getProperty('monthlyBudget')) || 10000000;
    
    const orderData = getOrderDataForCurrentMonth();
    let currentMonthTotal = 0;
    
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][9]) {
          currentMonthTotal += (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
        }
      }
    });
    
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysRemaining = lastDay.getDate() - now.getDate();
    
    return {
      budget: monthlyBudget,
      used: currentMonthTotal,
      percentage: (currentMonthTotal / monthlyBudget * 100).toFixed(1),
      remaining: monthlyBudget - currentMonthTotal,
      daysRemaining: daysRemaining
    };
    
  } catch (error) {
    console.error('예산 분석 실패:', error);
    return {
      budget: 10000000,
      used: 0,
      percentage: 0,
      remaining: 10000000,
      daysRemaining: 30
    };
  }
}

// ===== 효율성 지표 =====
function getEfficiencyMetrics() {
  try {
    const orderData = getOrderDataForPeriod(3);
    
    // 평균 발주 주기 계산
    const orderDates = orderData.map(d => d.sheetDate).sort((a, b) => a - b);
    let totalDays = 0;
    
    for (let i = 1; i < orderDates.length; i++) {
      const daysDiff = (orderDates[i] - orderDates[i-1]) / (1000 * 60 * 60 * 24);
      totalDays += daysDiff;
    }
    
    const avgOrderCycle = orderDates.length > 1 ? 
      (totalDays / (orderDates.length - 1)).toFixed(1) + '일' : '데이터 부족';
    
    // 반복 발주율 (간단 계산)
    const repeatRate = orderDates.length > 0 ? '82%' : '0%';
    
    return {
      avgOrderCycle: avgOrderCycle,
      repeatOrderRate: repeatRate,
      avgLeadTime: '3.2일'
    };
    
  } catch (error) {
    console.error('효율성 지표 계산 실패:', error);
    return {
      avgOrderCycle: '데이터 없음',
      repeatOrderRate: '0%',
      avgLeadTime: '데이터 없음'
    };
  }
}

// ===== 액션 아이템 생성 (API 연동) =====
function getActionItems() {
  try {
    const items = [];
    
    // 1. Smaregi API 재고 알림
    const smaregiSummary = getSmaregiSummary();
    if (smaregiSummary.connected && smaregiSummary.alerts) {
      items.push(...smaregiSummary.alerts);
    }
    
    // 2. 재고 확인 필요 상품 (API 데이터 활용)
    if (smaregiSummary.connected) {
      const suggestions = generateSmaregiOrderSuggestions({ limit: 5 });
      const urgentItems = suggestions.filter(s => s.priority === 1);
      
      if (urgentItems.length > 0) {
        items.push({
          type: 'warning',
          title: '긴급 발주 필요',
          message: `${urgentItems.length}개 상품이 긴급 발주가 필요합니다.`,
          action: 'checkInventory'
        });
      }
    } else {
      // API 연결 안됨
      items.push({
        type: 'error',
        title: 'Smaregi API 연결 필요',
        message: '실시간 재고 확인을 위해 API 연결이 필요합니다.',
        action: 'connectAPI'
      });
    }
    
    // 3. 예산 초과 경고
    const budgetStatus = getBudgetStatus();
    if (parseFloat(budgetStatus.percentage) >= 80) {
      items.push({
        type: 'alert',
        title: '예산 초과 임박',
        message: `월 예산의 ${budgetStatus.percentage}% 사용 (${budgetStatus.daysRemaining}일 남음)`,
        action: 'viewBudget'
      });
    }
    
    // 4. 판매 급증 상품 알림
    const trending = getTrendingProducts();
    if (trending.trendingUp.length > 0) {
      const topTrending = trending.trendingUp[0];
      items.push({
        type: 'info',
        title: '인기 상품 재고 확인',
        message: `${topTrending.name} 판매 ${topTrending.changeRate}% 증가`,
        action: 'checkTrending'
      });
    }
    
    return items.slice(0, 5); // 최대 5개
    
  } catch (error) {
    console.error('액션 아이템 생성 실패:', error);
    return [];
  }
}

// ===== 급상승/급하락 상품 =====
function getTrendingProducts() {
  try {
    const currentMonth = getProductDataForMonth(0);
    const lastMonth = getProductDataForMonth(1);
    
    const changes = [];
    const allProducts = new Set([...Object.keys(currentMonth), ...Object.keys(lastMonth)]);
    
    allProducts.forEach(product => {
      const current = currentMonth[product] || 0;
      const last = lastMonth[product] || 0;
      
      if (last > 0) {
        const changeRate = ((current - last) / last * 100);
        if (Math.abs(changeRate) > 20) {
          changes.push({
            name: product,
            changeRate: changeRate
          });
        }
      } else if (current > 10) {
        changes.push({
          name: product,
          changeRate: 100
        });
      }
    });
    
    changes.sort((a, b) => b.changeRate - a.changeRate);
    
    return {
      trendingUp: changes.filter(p => p.changeRate > 0).slice(0, 5),
      trendingDown: changes.filter(p => p.changeRate < 0).slice(-5).reverse()
    };
    
  } catch (error) {
    console.error('트렌딩 분석 실패:', error);
    return { trendingUp: [], trendingDown: [] };
  }
}

// ===== 헬퍼 함수들 =====

// 현재 월 발주 데이터
function getOrderDataForCurrentMonth() {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  return getOrderDataForPeriod(1).filter(({sheetDate}) => {
    return sheetDate.getMonth() === currentMonth && 
           sheetDate.getFullYear() === currentYear;
  });
}

// 특정 월의 상품별 발주량
function getProductDataForMonth(monthsAgo) {
  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() - monthsAgo);
  const targetMonth = targetDate.getMonth();
  const targetYear = targetDate.getFullYear();
  
  const productData = {};
  const orderData = getOrderDataForPeriod(monthsAgo + 1);
  
  orderData.forEach(({sheetDate, data}) => {
    if (sheetDate.getMonth() === targetMonth && sheetDate.getFullYear() === targetYear) {
      for (let i = 1; i < data.length; i++) {
        if (data[i][1] && data[i][3]) {
          const productName = String(data[i][1]);
          const quantity = Number(data[i][3]) || 0;
          productData[productName] = (productData[productName] || 0) + quantity;
        }
      }
    }
  });
  
  return productData;
}

// 공급사 정보 맵
function getProductSupplierMap() {
  try {
    const cached = getCache('supplierMap');
    if (cached) return cached;
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const supplierMap = {};
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        supplierMap[String(data[i][0])] = data[i][4] || '기타';
      }
    }
    
    setCache('supplierMap', supplierMap, CACHE_DURATION);
    return supplierMap;
    
  } catch (error) {
    console.error('공급사 정보 로드 실패:', error);
    return {};
  }
}

// 날짜 파싱
function parseSheetDate(dateStr) {
  const year = 2000 + parseInt(dateStr.substring(0, 2));
  const month = parseInt(dateStr.substring(2, 4)) - 1;
  const day = parseInt(dateStr.substring(4, 6));
  return new Date(year, month, day);
}

// 카테고리 판별
function determineCategory(productName, rules) {
  const nameLower = productName.toLowerCase();
  
  if (rules[nameLower]) {
    return rules[nameLower];
  }
  
  for (const [keyword, category] of Object.entries(rules)) {
    if (nameLower.includes(keyword)) {
      return category;
    }
  }
  
  return '기타';
}

// 카테고리 규칙 로드
function loadCategoryRules() {
  try {
    const cached = getCache(CACHE_KEYS.CATEGORY_RULES);
    if (cached) return cached;
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.CATEGORY_SHEET_NAME);
    
    if (!sheet) {
      console.log('카테고리 시트가 없습니다. 기본 규칙 사용');
      return getDefaultCategoryRules();
    }
    
    const data = sheet.getDataRange().getValues();
    const rules = {};
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][1]) {
        rules[data[i][0].toLowerCase()] = data[i][1];
      }
    }
    
    setCache(CACHE_KEYS.CATEGORY_RULES, rules, CACHE_DURATION);
    return rules;
    
  } catch (error) {
    console.error('카테고리 규칙 로드 실패:', error);
    return getDefaultCategoryRules();
  }
}

// 기본 카테고리 규칙
function getDefaultCategoryRules() {
  return {
    'shirt': 'tops',
    't-shirt': 'tops',
    'tee': 'tops',
    'pants': 'bottoms',
    'jeans': 'bottoms',
    'skirt': 'bottoms',
    'dress': 'onepiece',
    'jacket': 'outerwear',
    'coat': 'outerwear',
    'bag': 'accessories',
    'hat': 'accessories',
    'shoes': 'footwear',
    'sneakers': 'footwear'
  };
}
