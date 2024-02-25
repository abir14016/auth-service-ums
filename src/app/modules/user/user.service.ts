import httpStatus from 'http-status';
import mongoose, { SortOrder } from 'mongoose';
import config from '../../../config/index';
import ApiError from '../../../errors/ApiError';
import { RedisClient } from '../../../shared/redis';
import { IAcademicSemester } from '../academicSemester/academicSemester.interface';
import { AcademicSemester } from '../academicSemester/academicSemester.model';
import { IAdmin } from '../admin/admin.interface';
import { Admin } from '../admin/admin.model';
// import { sendLoginEmail } from '../auth/sendLoginMail';
import { paginationHelpers } from '../../../helpers/paginationHelper';
import { IGenericResponse } from '../../../interfaces/common';
import { IPaginationOptions } from '../../../interfaces/pagination';
import { sendLoginEmail } from '../auth/sendLoginMail';
import { IFaculty } from '../faculty/faculty.interface';
import { Faculty } from '../faculty/faculty.model';
import { IStudent } from '../student/student.interface';
import { Student } from '../student/student.model';
import {
  EVENT_FACULTY_CREATED,
  EVENT_STUDENT_CREATED,
  userSearchableFields,
} from './user.constant';
import { IUser, IUserFilters } from './user.interface';
import { User } from './user.model';
import {
  generateAdminId,
  generateFacultyId,
  generateStudentId,
} from './user.utils';

const getAllUsers = async (
  filters: IUserFilters,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<IUser[]>> => {
  // Extract searchTerm to implement search query
  const { searchTerm, ...filtersData } = filters;
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(paginationOptions);

  const andConditions = [];
  // Search needs $or for searching in specified fields
  if (searchTerm) {
    andConditions.push({
      $or: userSearchableFields.map(field => ({
        [field]: {
          $regex: searchTerm,
          $options: 'i',
        },
      })),
    });
  }
  // Filters needs $and to fullfill all the conditions
  if (Object.keys(filtersData).length) {
    andConditions.push({
      $and: Object.entries(filtersData).map(([field, value]) => ({
        [field]: value,
      })),
    });
  }

  // Dynamic  Sort needs  field to  do sorting
  const sortConditions: { [key: string]: SortOrder } = {};
  if (sortBy && sortOrder) {
    sortConditions[sortBy] = sortOrder;
  }
  const whereConditions =
    andConditions.length > 0 ? { $and: andConditions } : {};

  const result = await User.find(whereConditions)
    .sort(sortConditions)
    .skip(skip)
    .limit(limit);

  const total = await User.countDocuments();

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: result,
  };
};

const createStudent = async (
  student: IStudent,
  user: IUser
): Promise<IUser | null> => {
  // If password is not given,set default password
  if (!user.password) {
    user.password = config.default_student_pass as string;
  }
  // set role
  user.role = 'student';

  const academicsemester = await AcademicSemester.findById(
    student.academicSemester
  ).lean();

  let newUserAllData = null;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    // generate student id
    const id = await generateStudentId(academicsemester as IAcademicSemester);
    // set custom id into both  student & user
    user.id = id;
    student.id = id;

    // Create student using sesssin
    const newStudent = await Student.create([student], { session });

    if (!newStudent.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create student');
    }

    // set student _id (reference) into user.student
    user.student = newStudent[0]._id;

    const newUser = await User.create([user], { session });

    if (!newUser.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create user');
    }
    newUserAllData = newUser[0];

    //sending login credentials to the student through email
    await sendLoginEmail(
      student.email,
      `
      <div>
        <p style="font-size: 14px;">Hi <strong>${student.name.firstName} ${student.name.middleName} ${student.name.lastName},</strong></p>
        <br>
        <p style="font-size: 18px;"><strong>Congratulations!</strong> Your ${user.role} profile has been created successfully.</p>
        <p style="font-size: 14px;">Please login by visiting the link http://localhost:3000/login with the following credentials:</p>
        <br>
        <div style="background-color: #B2BEB5; padding: 30px; width: 50%;">
          <p style="font-size: 16px;"><strong>Your Login credentials:</strong></p>
          <p style="font-size: 14px;">ID: ${user.id}</p>
          <p style="font-size: 14px;">Password: ${user.password}</p>
        </div>
        <br>
        <p style="font-size: 15px;"><strong>Thank You</strong></p>
    </div>
    `
    );
    //sending login credentials to the student through email

    await session.commitTransaction();
    await session.endSession();
  } catch (error) {
    await session.abortTransaction();
    await session.endSession();
    throw error;
  }

  if (newUserAllData) {
    newUserAllData = await User.findOne({ id: newUserAllData.id }).populate({
      path: 'student',
      populate: [
        {
          path: 'academicSemester',
        },
        {
          path: 'academicDepartment',
        },
        {
          path: 'academicFaculty',
        },
      ],
    });
  }

  if (newUserAllData) {
    await RedisClient.publish(
      EVENT_STUDENT_CREATED,
      JSON.stringify(newUserAllData.student)
    );
  }

  return newUserAllData;
};

const createFaculty = async (
  faculty: IFaculty,
  user: IUser
): Promise<IUser | null> => {
  // If password is not given,set default password
  if (!user.password) {
    user.password = config.default_faculty_pass as string;
  }

  // set role
  user.role = 'faculty';

  let newUserAllData = null;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    // generate faculty id
    const id = await generateFacultyId();
    // set custom id into both  faculty & user
    user.id = id;
    faculty.id = id;
    // Create faculty using sesssin
    const newFaculty = await Faculty.create([faculty], { session });

    if (!newFaculty.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create faculty ');
    }
    // set faculty _id (reference) into user.student
    user.faculty = newFaculty[0]._id;

    const newUser = await User.create([user], { session });

    if (!newUser.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create faculty');
    }
    newUserAllData = newUser[0];

    //sending login credentials to the faculty through email
    await sendLoginEmail(
      faculty.email,
      `
      <div>
        <p style="font-size: 14px;">Hi <strong>${faculty.name.firstName} ${faculty.name.middleName} ${faculty.name.lastName},</strong></p>
        <br>
        <p style="font-size: 18px;"><strong>Congratulations!</strong> Your ${user.role} profile has been created successfully.</p>
        <p style="font-size: 14px;">Please login by visiting the link http://localhost:3000/login with the following credentials:</p>
        <br>
        <div style="background-color: #B2BEB5; padding: 30px; width: 50%;">
          <p style="font-size: 16px;"><strong>Your Login credentials:</strong></p>
          <p style="font-size: 14px;">ID: ${user.id}</p>
          <p style="font-size: 14px;">Password: ${user.password}</p>
        </div>
        <br>
        <p style="font-size: 15px;"><strong>Thank You</strong></p>
    </div>
    `
    );
    //sending login credentials to the faculty through email

    await session.commitTransaction();
    await session.endSession();
  } catch (error) {
    await session.abortTransaction();
    await session.endSession();
    throw error;
  }

  if (newUserAllData) {
    newUserAllData = await User.findOne({ id: newUserAllData.id }).populate({
      path: 'faculty',
      populate: [
        {
          path: 'academicDepartment',
        },
        {
          path: 'academicFaculty',
        },
      ],
    });
  }

  if (newUserAllData) {
    await RedisClient.publish(
      EVENT_FACULTY_CREATED,
      JSON.stringify(newUserAllData.faculty)
    );
  }

  return newUserAllData;
};

const createAdmin = async (
  admin: IAdmin,
  user: IUser
): Promise<IUser | null> => {
  if (!user.password) {
    user.password = config.default_admin_pass as string;
  }
  // set role
  user.role = 'admin';

  let newUserAllData = null;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    // generate admin id
    const id = await generateAdminId();
    user.id = id;
    admin.id = id;

    const newAdmin = await Admin.create([admin], { session });

    if (!newAdmin.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create faculty ');
    }

    user.admin = newAdmin[0]._id;

    const newUser = await User.create([user], { session });

    if (!newUser.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create admin');
    }
    newUserAllData = newUser[0];

    //sending login credentials to the admin through email
    await sendLoginEmail(
      admin.email,
      `
      <div>
        <p style="font-size: 14px;">Hi <strong>${admin.name.firstName} ${admin.name.middleName} ${admin.name.lastName},</strong></p>
        <br>
        <p style="font-size: 18px;"><strong>Congratulations!</strong> Your ${user.role} profile has been created successfully.</p>
        <p style="font-size: 14px;">Please login by visiting the link http://localhost:3000/login with the following credentials:</p>
        <br>
        <div style="background-color: #B2BEB5; padding: 30px; width: 50%;">
          <p style="font-size: 16px;"><strong>Your Login credentials:</strong></p>
          <p style="font-size: 14px;">ID: ${user.id}</p>
          <p style="font-size: 14px;">Password: ${user.password}</p>
        </div>
        <br>
        <p style="font-size: 15px;"><strong>Thank You</strong></p>
    </div>
    `
    );
    //sending login credentials to the admin through email

    await session.commitTransaction();
    await session.endSession();
  } catch (error) {
    await session.abortTransaction();
    await session.endSession();
    throw error;
  }

  if (newUserAllData) {
    newUserAllData = await User.findOne({ id: newUserAllData.id }).populate({
      path: 'admin',
      populate: [
        {
          path: 'managementDepartment',
        },
      ],
    });
  }

  return newUserAllData;
};

const getSingleUser = async (id: string): Promise<IUser | null> => {
  const result = await User.findOne({ id });
  return result;
};

export const UserService = {
  getAllUsers,
  createStudent,
  createFaculty,
  createAdmin,
  getSingleUser,
};
