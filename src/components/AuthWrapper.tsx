import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const AuthWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const userProfile = localStorage.getItem('userProfile');

    if (userProfile) {
      // User is logged in
      if (location.pathname === '/') {
        navigate('/app', { replace: true });
      }
    } else {
      // User is not logged in
      if (location.pathname.startsWith('/app')) {
        navigate('/', { replace: true });
      }
    }
  }, [navigate, location.pathname]);

  return <>{children}</>;
};

export default AuthWrapper;
