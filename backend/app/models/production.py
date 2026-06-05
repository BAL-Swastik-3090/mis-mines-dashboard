from sqlalchemy import Column, String, Date, Numeric, Integer, Text, BigInteger
from app.database import Base


class PpProduction(Base):
    """SAP PP production postings — ore, OB, COB actuals."""
    __tablename__ = "pp_production"

    ORDER_NUMBER      = Column(String(12),    primary_key=True)
    ORDER_TYPE        = Column(String(4),     nullable=False)
    ORDER_DESC        = Column(String(40))
    CREATED_ON        = Column(Date)
    COMPANY_CODE      = Column(String(4))
    PLANT             = Column(String(4))
    MATERIAL_DOCUMENT = Column(String(10),    primary_key=True)
    DOCUMENT_YEAR     = Column(String(4))
    MAT_DOC_ITEM      = Column(String(4),     primary_key=True)
    MOVEMENT_TYPE     = Column(String(3))
    MATERIAL_NO       = Column(String(40))
    MATERIAL_DESC     = Column(String(40))
    STORAGE_LOCATION  = Column(String(4))
    BATCH_NUMBER      = Column(String(10))
    AMOUNT_LOCAL_CURR = Column(Numeric(13, 2))
    QUANTITY          = Column(Numeric(13, 3))
    UNIT              = Column(String(3))
    POSTING_DATE      = Column(Date)
    MSG               = Column(String(100))


class MinesDailyExcavationPlan(Base):
    """Daily mine excavation plan — ore & OB per shift × location."""
    __tablename__ = "mines_daily_excavation_plan"

    Prod_date  = Column(Date,         primary_key=True)
    Shift      = Column(String(1),    primary_key=True)
    Loc_Id     = Column(Integer,      primary_key=True)
    Face_Desc  = Column(String(30))
    OB_QTY_Cum = Column(String(50))   # stored as VARCHAR — cast in queries
    ORE_QTY    = Column(Numeric(13, 3))
    HG_QTY     = Column(Numeric(13, 3))
    MG_QTY     = Column(Numeric(13, 3))
    LG_QTY     = Column(Numeric(13, 3))
    Entry_Id   = Column(String(10))
    Entry_Date = Column(Date)


class MinesCobpPlan(Base):
    """COB plant daily plan — concentrate, feed, tailings."""
    __tablename__ = "mines_cobp_plan"

    Si_no                   = Column(BigInteger,    primary_key=True)
    Plan_date               = Column(Date,          primary_key=True)
    Plan_month              = Column(String(10),    primary_key=True)
    Total_avail_hr          = Column(Numeric(10, 2))
    Shutdown_hr             = Column(Numeric(10, 2))
    Planned_running_hr      = Column(Numeric(10, 2))
    Throughput_capacity     = Column(Numeric(10, 2))
    Planned_feed_rate       = Column(Numeric(10, 2))
    Feed_qty                = Column(Numeric(12, 2))
    Feed_grade_Cr2O3        = Column(Numeric(8, 3))
    Feed_ratio_CrFe         = Column(Numeric(8, 3))
    Weight_recovery         = Column(Numeric(8, 3))
    Concentrate_qty         = Column(Numeric(12, 2))
    Concentrate_grade_Cr2O3 = Column(Numeric(8, 3))
    Concentrate_ratio_CrFe  = Column(Numeric(8, 3))
    Chrome_recovery         = Column(Numeric(8, 3))
    Tailings_qty            = Column(Numeric(12, 2))
    Tailings_grade_Cr2O3    = Column(Numeric(8, 3))
    Remarks                 = Column(Text)
    Entry_Id                = Column(String(10))
    Entry_Date              = Column(Date)
