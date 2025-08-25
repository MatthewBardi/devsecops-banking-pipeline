import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [accountData, setAccountData] = useState(null);
  const [healthStatus, setHealthStatus] = useState('checking...');

  useEffect(() => {
    // Check service health
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setHealthStatus('‚úÖ Services Online'))
      .catch(err => setHealthStatus('‚ùå Services Offline'));
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    // Simulate login process
    setAccountData({
      accountNumber: '**** **** **** 1234',
      balance: '$2,543.21',
      lastTransaction: 'ATM Withdrawal - $40.00'
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Ìø¶ SecureBank</h1>
        <p className="status">Status: {healthStatus}</p>
      </header>

      <main className="main-content">
        {!accountData ? (
          <div className="login-container">
            <h2>Ì¥í Secure Login</h2>
            <form onSubmit={handleLogin} className="login-form">
              <div className="form-group">
                <label>Username:</label>
                <input 
                  type="text" 
                  required 
                  placeholder="Enter username"
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Password:</label>
                <input 
                  type="password" 
                  required 
                  placeholder="Enter password"
                  className="form-input"
                />
              </div>
              <button type="submit" className="login-btn">
                Ì¥ê Secure Login
              </button>
            </form>
            
            <div className="security-features">
              <h3>Ìª°Ô∏è Security Features</h3>
              <ul>
                <li>‚úÖ 256-bit SSL Encryption</li>
                <li>‚úÖ Multi-Factor Authentication</li>
                <li>‚úÖ Fraud Detection</li>
                <li>‚úÖ Real-time Monitoring</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="dashboard">
            <h2>Ì≤º Account Dashboard</h2>
            <div className="account-card">
              <h3>Account Overview</h3>
              <p><strong>Account:</strong> {accountData.accountNumber}</p>
              <p><strong>Balance:</strong> <span className="balance">{accountData.balance}</span></p>
              <p><strong>Last Transaction:</strong> {accountData.lastTransaction}</p>
            </div>
            
            <div className="actions">
              <button className="action-btn">Ì≤∏ Transfer Funds</button>
              <button className="action-btn">Ì≥ä View Statements</button>
              <button className="action-btn">‚öôÔ∏è Account Settings</button>
              <button 
                className="action-btn logout-btn"
                onClick={() => setAccountData(null)}
              >
                Ì∫™ Secure Logout
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Ì¥í SecureBank - Your Security is Our Priority</p>
        <p>Protected by advanced DevSecOps practices</p>
      </footer>
    </div>
  );
}

export default App;
