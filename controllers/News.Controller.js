const News = require('../models/News.model');

// 뉴스 생성
const createNews = async (req, res) => {
  try {
    const { title, subtitle, link, registrationDate } = req.body;
    
    // 필수 필드 검증
    if (!title || !subtitle || !link) {
      return res.status(400).json({
        success: false,
        message: '제목, 부제목, 링크는 필수 입력 항목입니다.'
      });
    }

    // 링크 URL 형식 검증
    const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
    if (!urlPattern.test(link)) {
      return res.status(400).json({
        success: false,
        message: '올바른 URL 형식이 아닙니다.'
      });
    }

    const newsData = {
      title,
      subtitle,
      link,
      registrationDate: registrationDate ? new Date(registrationDate) : new Date()
    };

    const news = new News(newsData);
    await news.save();

    res.status(201).json({
      success: true,
      message: '뉴스가 성공적으로 등록되었습니다.',
      data: news
    });
  } catch (error) {
    console.error('뉴스 생성 오류:', error);
    res.status(500).json({
      success: false,
      message: '뉴스 등록 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 모든 뉴스 조회
const getAllNews = async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const news = await News.find()
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await News.countDocuments();

    res.status(200).json({
      success: true,
      data: news,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('뉴스 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '뉴스 조회 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 특정 뉴스 조회
const getNewsById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const news = await News.findById(id);
    
    if (!news) {
      return res.status(404).json({
        success: false,
        message: '해당 뉴스를 찾을 수 없습니다.'
      });
    }

    res.status(200).json({
      success: true,
      data: news
    });
  } catch (error) {
    console.error('뉴스 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '뉴스 조회 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 뉴스 수정
const updateNews = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, link, registrationDate } = req.body;

    const updateData = {};
    if (title) updateData.title = title;
    if (subtitle) updateData.subtitle = subtitle;
    if (link) {
      // 링크 URL 형식 검증
      const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
      if (!urlPattern.test(link)) {
        return res.status(400).json({
          success: false,
          message: '올바른 URL 형식이 아닙니다.'
        });
      }
      updateData.link = link;
    }
    if (registrationDate) updateData.registrationDate = new Date(registrationDate);

    const news = await News.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!news) {
      return res.status(404).json({
        success: false,
        message: '해당 뉴스를 찾을 수 없습니다.'
      });
    }

    res.status(200).json({
      success: true,
      message: '뉴스가 성공적으로 수정되었습니다.',
      data: news
    });
  } catch (error) {
    console.error('뉴스 수정 오류:', error);
    res.status(500).json({
      success: false,
      message: '뉴스 수정 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 뉴스 삭제
const deleteNews = async (req, res) => {
  try {
    const { id } = req.params;
    
    const news = await News.findByIdAndDelete(id);
    
    if (!news) {
      return res.status(404).json({
        success: false,
        message: '해당 뉴스를 찾을 수 없습니다.'
      });
    }

    res.status(200).json({
      success: true,
      message: '뉴스가 성공적으로 삭제되었습니다.'
    });
  } catch (error) {
    console.error('뉴스 삭제 오류:', error);
    res.status(500).json({
      success: false,
      message: '뉴스 삭제 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 뉴스 검색
const searchNews = async (req, res) => {
  try {
    const { keyword, page = 1, limit = 10 } = req.query;
    
    if (!keyword) {
      return res.status(400).json({
        success: false,
        message: '검색 키워드를 입력해주세요.'
      });
    }

    const searchRegex = new RegExp(keyword, 'i');
    const searchQuery = {
      $or: [
        { title: searchRegex },
        { subtitle: searchRegex }
      ]
    };

    const news = await News.find(searchQuery)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await News.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      data: news,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('뉴스 검색 오류:', error);
    res.status(500).json({
      success: false,
      message: '뉴스 검색 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

module.exports = {
  createNews,
  getAllNews,
  getNewsById,
  updateNews,
  deleteNews,
  searchNews
};