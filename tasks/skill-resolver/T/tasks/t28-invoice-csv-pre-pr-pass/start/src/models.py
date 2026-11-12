from sqlalchemy import Column, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Customer(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)


class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True)
    number = Column(String, nullable=False)
    month = Column(String, nullable=False)
    currency = Column(String, default="EUR")
    issued_at = Column(Date, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    customer = relationship(Customer)
    lines = relationship("InvoiceLine")


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"))
    amount = Column(Numeric(12, 2), nullable=False)
