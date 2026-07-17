from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
import hashlib
from ..database import get_db

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

class LoginRequest(BaseModel):
    empid: str
    password: str

@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    # Clean inputs
    empid_clean = req.empid.strip()
    password_clean = req.password
    
    # Hash password using legacy SHA-1 matching the database format
    password_hash = hashlib.sha1(password_clean.encode('utf-8')).hexdigest()
    
    # Query database
    query = """
        SELECT EMPID, USER_PWD, STATUS
        FROM intranet_user_login
        WHERE EMPID = :empid
    """
    row = db.execute(text(query), {"empid": empid_clean}).fetchone()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Employee ID or Password"
        )
        
    db_empid, db_pwd, db_status = row
    
    # Verify password hash (case-insensitive comparison just in case)
    if not db_pwd or db_pwd.lower() != password_hash.lower():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Employee ID or Password"
        )
        
    # Check if user status is active
    if db_status and db_status.upper() != 'A':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your account is inactive. Please contact administrator"
        )
        
    return {
        "status": "success",
        "token": f"mock-session-token-{db_empid}",
        "empid": db_empid
    }
