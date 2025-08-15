module.exports = (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  };